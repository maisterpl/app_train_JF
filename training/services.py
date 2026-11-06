"""Decimal calculations, immutable training snapshots and idempotent sync."""
import uuid
from datetime import date as date_type, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import (BodyWeight, OneRepMax, Prescription, SyncReceipt, Workout,
                     WorkoutExercise, WorkoutSet)


PRESCRIPTION_FIELDS = [f.name for f in Prescription._meta.fields]


def decimal_text(value):
    if value is None:
        return None
    return format(Decimal(str(value)).normalize(), 'f')


def prescription_data(prescription):
    data = {}
    for key in PRESCRIPTION_FIELDS:
        value = prescription.get(key) if isinstance(prescription, dict) else getattr(prescription, key)
        data[key] = decimal_text(value) if isinstance(value, Decimal) else value
    return data


def _number(value, label, *, positive=False):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError(f'{label}: podaj poprawną liczbę.')
    if not number.is_finite() or number < 0 or (positive and number == 0):
        raise ValidationError(f'{label}: liczba musi być {"dodatnia" if positive else "nieujemna"}.')
    return number


def calculate_load(prescription, rm=None, body=None, step=Decimal('2.5')):
    """Return rounded kg without substituting zero for an unknown input."""
    p = prescription_data(prescription)
    basis = p.get('basis')
    output = {'min': None, 'max': None, 'explanation': '', 'missing': ''}
    if basis == 'none':
        output['explanation'] = 'Bez dodatkowego obciążenia'
        return output
    if basis not in {'rm', 'body', 'fixed'}:
        output['missing'] = 'Brak danych: podstawa obliczeń'
        output['explanation'] = output['missing']
        return output
    if basis == 'fixed':
        if p.get('fixed_weight') is None:
            output['missing'] = 'Brak danych: stały ciężar'
            output['explanation'] = output['missing']
            return output
        low = high = _number(p['fixed_weight'], 'Ciężar')
        prefix = 'Stały ciężar'
    else:
        value = rm if basis == 'rm' else body
        if value is None:
            output['missing'] = ('Uzupełnij 1RM tego ćwiczenia' if basis == 'rm' else 'Dodaj pomiar masy ciała na dzień treningu lub wcześniejszy')
            output['explanation'] = output['missing']
            return output
        if p.get('percent_min') is None:
            output['missing'] = 'Brak danych: procent obciążenia'
            output['explanation'] = output['missing']
            return output
        source = _number(value, 'Podstawa obciążenia', positive=True)
        percent_low = _number(p['percent_min'], 'Procent')
        percent_high = _number(p.get('percent_max') if p.get('percent_max') is not None else percent_low, 'Procent')
        if percent_high < percent_low:
            raise ValidationError('Górny procent nie może być mniejszy od dolnego.')
        low, high = percent_low * source / 100, percent_high * source / 100
        percent_label = decimal_text(percent_low)
        if percent_low != percent_high:
            percent_label += '–' + decimal_text(percent_high)
        prefix = f'{percent_label}% × {decimal_text(source)} kg {"1RM" if basis == "rm" else "masy ciała"}'
    rounding = _number(step, 'Krok zaokrąglania', positive=True)
    rounded = [(value / rounding).quantize(Decimal('1'), rounding=ROUND_HALF_UP) * rounding for value in (low, high)]
    output['min'], output['max'] = map(decimal_text, rounded)
    result = output['min'] if output['min'] == output['max'] else f'{output["min"]}–{output["max"]}'
    output['explanation'] = f'{prefix} = {result} kg (krok {decimal_text(rounding)} kg)'
    return output


def _uuid(value, label):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError(f'{label}: niepoprawny identyfikator UUID.')


@transaction.atomic
def start_workout(plan, date=None, workout_id=None):
    training_date = date or timezone.localdate()
    if isinstance(training_date, str):
        try:
            training_date = date_type.fromisoformat(training_date)
        except ValueError:
            raise ValidationError('Niepoprawna data treningu.')
    requested_id = _uuid(workout_id, 'Trening') if workout_id else uuid.uuid4()
    existing = Workout.objects.filter(pk=requested_id).first()
    if existing:
        if existing.profile_id != plan.profile_id or existing.plan_id != plan.pk:
            raise ValidationError('Ten identyfikator treningu jest już używany.')
        return existing
    items = list(plan.items.select_related('exercise').all())
    if not items:
        raise ValidationError('Dodaj co najmniej jedno ćwiczenie do planu.')
    body = BodyWeight.objects.filter(profile=plan.profile, date__lte=training_date).order_by('-date', '-pk').first()
    now = timezone.now()
    workout = Workout.objects.create(
        id=requested_id, profile=plan.profile, plan=plan, plan_name=plan.name,
        phase_name=plan.phase.name, started_at=now, training_date=training_date,
        body_weight=body.value if body else None, body_weight_date=body.date if body else None,
        rounding_step=plan.profile.rounding_step,
    )
    for position, item in enumerate(items, 1):
        rm = OneRepMax.objects.filter(profile=plan.profile, exercise=item.exercise, date__lte=training_date).order_by('-date', '-pk').first()
        previous = WorkoutExercise.objects.filter(
            workout__profile=plan.profile, workout__status='completed',
            workout__training_date__lte=training_date, exercise=item.exercise,
            sets__deleted=False,
        ).order_by('-workout__training_date', '-workout__started_at').first()
        previous_results = []
        if previous:
            previous_results = [dict(
                date=previous.workout.training_date.isoformat(), number=s.number,
                weight=decimal_text(s.weight), reps=s.reps, seconds=s.seconds,
            ) for s in previous.sets.filter(deleted=False)]
        snapshot = prescription_data(item)
        snapshot.update(
            name=item.exercise.name, mode=item.exercise.mode,
            description=item.exercise.description, category=item.exercise.category,
            load_notation=item.exercise.load_notation,
            exercise_id=item.exercise_id, overridden=item.overridden,
            rm=decimal_text(rm.value) if rm else None, rm_date=rm.date.isoformat() if rm else None,
            body_weight=decimal_text(body.value) if body else None,
            body_weight_date=body.date.isoformat() if body else None,
            load=calculate_load(item, rm=rm.value if rm else None, body=body.value if body else None, step=plan.profile.rounding_step),
            previous_results=previous_results,
        )
        WorkoutExercise.objects.create(workout=workout, exercise=item.exercise, position=position, snapshot=snapshot)
    return workout


def serialize_workout(workout):
    return {
        'id': str(workout.pk), 'profile_id': workout.profile_id, 'profile_name': workout.profile.name,
        'plan_name': workout.plan_name, 'phase_name': workout.phase_name,
        'training_date': workout.training_date.isoformat(),
        'status': workout.status, 'started_at': workout.started_at.isoformat(),
        'finished_at': workout.finished_at.isoformat() if workout.finished_at else None,
        'current_position': workout.current_position,
        'body_weight': decimal_text(workout.body_weight),
        'body_weight_date': workout.body_weight_date.isoformat() if workout.body_weight_date else None,
        'rounding_step': decimal_text(workout.rounding_step),
        'exercises': [{
            'id': str(exercise.pk), 'position': exercise.position,
            'skipped': exercise.skipped, 'snapshot': exercise.snapshot,
            'sets': [{
                'id': str(s.pk), 'number': s.number, 'weight': decimal_text(s.weight),
                'reps': s.reps, 'seconds': s.seconds, 'note': s.note,
            } for s in exercise.sets.filter(deleted=False)]
        } for exercise in workout.exercises.all()],
    }


def _integer(value, label):
    if isinstance(value, bool):
        raise ValidationError(f'{label}: podaj nieujemną liczbę całkowitą.')
    number = _number(value, label)
    if number != number.to_integral_value() or number > 2147483647:
        raise ValidationError(f'{label}: podaj nieujemną liczbę całkowitą.')
    return int(number)


def _get_exercise(workout, operation):
    exercise_id = _uuid(operation.get('exercise_id'), 'Ćwiczenie')
    try:
        return workout.exercises.get(pk=exercise_id)
    except WorkoutExercise.DoesNotExist:
        raise ValidationError('Ćwiczenie nie należy do tego treningu.')


@transaction.atomic
def apply_operations(workout, operations):
    if not isinstance(operations, list) or len(operations) > 1000:
        raise ValidationError('Oczekiwano listy maksymalnie 1000 zmian.')
    workout = Workout.objects.select_for_update().get(pk=workout.pk)
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValidationError('Niepoprawny format zmiany.')
        operation_id = _uuid(operation.get('id'), 'Zmiana')
        receipt = SyncReceipt.objects.filter(pk=operation_id).first()
        if receipt:
            if receipt.workout_id != workout.pk:
                raise ValidationError('Identyfikator zmiany jest już używany w innym treningu.')
            continue
        if workout.status != 'active':
            raise ValidationError('Trening jest zakończony. Nie można dopisywać ani zmieniać serii.')
        operation_type = operation.get('type')
        if operation_type == 'set.upsert':
            exercise = _get_exercise(workout, operation)
            values = operation.get('set')
            if not isinstance(values, dict):
                raise ValidationError('Brak danych serii.')
            set_id = _uuid(values.get('id'), 'Seria')
            existing = WorkoutSet.objects.filter(pk=set_id).first()
            if existing and existing.workout_exercise_id != exercise.pk:
                raise ValidationError('Seria nie należy do tego ćwiczenia.')
            weight = _number(values.get('weight', 0), 'Ciężar')
            reps = _integer(values.get('reps'), 'Powtórzenia') if exercise.snapshot.get('mode') != 'time' else None
            seconds = _integer(values.get('seconds'), 'Czas') if exercise.snapshot.get('mode') == 'time' else None
            note = values.get('note', '')
            if not isinstance(note, str) or len(note) > 500:
                raise ValidationError('Notatka może zawierać maksymalnie 500 znaków.')
            if existing:
                if existing.deleted:
                    raise ValidationError('Usuniętej serii nie można ponownie zapisać. Dodaj nową serię.')
                row = existing
            else:
                number = (exercise.sets.filter(deleted=False).aggregate(value=Max('number'))['value'] or 0) + 1
                row = WorkoutSet(id=set_id, workout_exercise=exercise, number=number)
            row.weight, row.reps, row.seconds, row.note = weight, reps, seconds, note
            row.full_clean()
            row.save()
            if exercise.skipped:
                exercise.skipped = False
                exercise.save(update_fields=['skipped'])
        elif operation_type == 'set.delete':
            exercise = _get_exercise(workout, operation)
            set_id = _uuid(operation.get('set_id'), 'Seria')
            row = exercise.sets.filter(pk=set_id).first()
            if not row:
                raise ValidationError('Nie znaleziono serii w tym ćwiczeniu.')
            row.deleted = True
            row.save(update_fields=['deleted'])
            for number, row in enumerate(exercise.sets.filter(deleted=False), 1):
                if row.number != number:
                    row.number = number
                    row.save(update_fields=['number'])
        elif operation_type == 'navigate':
            position = _integer(operation.get('position'), 'Pozycja ćwiczenia')
            if position >= workout.exercises.count():
                raise ValidationError('Niepoprawna pozycja ćwiczenia.')
            workout.current_position = position
            workout.save(update_fields=['current_position'])
        elif operation_type == 'skip':
            exercise = _get_exercise(workout, operation)
            if not isinstance(operation.get('skipped'), bool):
                raise ValidationError('Niepoprawny stan pominięcia ćwiczenia.')
            exercise.skipped = operation['skipped']
            exercise.save(update_fields=['skipped'])
        elif operation_type == 'finish':
            finished_at = timezone.now()
            if 'finished_at' in operation:
                try:
                    finished_at = parse_datetime(operation['finished_at'])
                except (TypeError, ValueError):
                    finished_at = None
                if finished_at is None or timezone.is_naive(finished_at):
                    raise ValidationError('Niepoprawna data zakończenia treningu; wymagana jest strefa czasowa.')
            if finished_at < workout.started_at or finished_at > timezone.now() + timedelta(minutes=5):
                raise ValidationError('Data zakończenia treningu musi przypadać po jego rozpoczęciu i nie może być w przyszłości.')
            workout.status = 'completed'
            workout.finished_at = finished_at
            workout.save(update_fields=['status', 'finished_at'])
        else:
            raise ValidationError('Nieznany typ zmiany treningu.')
        SyncReceipt.objects.create(id=operation_id, workout=workout)
    return serialize_workout(workout)
