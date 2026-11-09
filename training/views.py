import csv
import json
import re
from collections import defaultdict
from functools import wraps
from django.contrib import messages
from django.core import serializers
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Prefetch
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST
from .forms import (AddExercisesForm, AddPhaseSlotsForm, BodyWeightForm, EstimateRMForm, OneRepMaxForm, PlanForm,
                    PlanItemForm, PRESCRIPTION_FIELDS, ProfileForm, SettingsForm, StartWorkoutForm)
from .models import (BodyWeight, Exercise, OneRepMax, Phase, PhaseSlot, Plan, PlanItem, Profile, StrengthGoal,
                     Recommendation, Workout, WorkoutExercise, WorkoutSet)
from .services import calculate_goal, calculate_load, estimate_rm, serialize_workout, start_workout
from .progress import exercise_progress


def get_active_profile(request):
    profile = Profile.objects.filter(pk=request.session.get('active_profile_id')).first()
    if profile is None:
        profile = Profile.objects.order_by('pk').first()
        if profile:
            request.session['active_profile_id'] = profile.pk
    return profile


def profile_required(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not get_active_profile(request):
            messages.info(request, 'Utwórz pierwszy profil, aby rozpocząć trening.')
            return redirect('profiles')
        return view(request, *args, **kwargs)
    return wrapped


def _render(request, template, context=None, **kwargs):
    data = {'active_profile': get_active_profile(request)}
    data.update(context or {})
    return render(request, f'training/{template}.html', data, **kwargs)


def _form(request, form, title, back_url, **extra):
    return _render(request, 'form', {'form': form, 'title': title, 'back_url': back_url, **extra})


@profile_required
def dashboard(request):
    p = get_active_profile(request)
    return _render(request, 'dashboard', {
        'last_workout': Workout.objects.filter(profile=p).order_by('-started_at').first(),
        'active_workouts': Workout.objects.filter(profile=p, status='active').order_by('-started_at'),
        'plans': Plan.objects.filter(profile=p).select_related('phase'),
        'latest_weight': BodyWeight.objects.filter(profile=p, date__lte=timezone.localdate()).order_by('-date', '-pk').first()})


def profiles(request):
    form = ProfileForm(request.POST if request.method == 'POST' else None)
    if request.method == 'POST' and form.is_valid():
        p = form.save()
        request.session['active_profile_id'] = p.pk
        messages.success(request, 'Profil utworzony. Dodaj pomiar masy ciała.')
        return redirect('profile_detail', profile_id=p.pk)
    return _render(request, 'profiles', {'profiles': Profile.objects.all(), 'form': form})


def profile_edit(request, profile_id):
    p = get_object_or_404(Profile, pk=profile_id)
    form = ProfileForm(request.POST if request.method == 'POST' else None, instance=p)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Zapisano profil.')
        return redirect('profile_detail', profile_id=p.pk)
    return _form(request, form, 'Edytuj profil', reverse('profile_detail', args=[p.pk]))


@require_POST
def profile_switch(request, profile_id):
    p = get_object_or_404(Profile, pk=profile_id)
    request.session['active_profile_id'] = p.pk
    return redirect('dashboard')


def profile_detail(request, profile_id):
    p = get_object_or_404(Profile, pk=profile_id)
    form = BodyWeightForm(request.POST if request.method == 'POST' else None)
    if request.method == 'POST':
        form.instance.profile = p
        if form.is_valid():
            form.save()
            messages.success(request, 'Zapisano pomiar masy ciała.')
            return redirect('profile_detail', profile_id=p.pk)
    return _render(request, 'profile_detail', {'profile': p, 'weights': BodyWeight.objects.filter(profile=p).order_by('-date', '-pk'), 'form': form})


@profile_required
def plans(request):
    codes = ('AA', 'SM', 'WM', 'WS', 'US')
    available = {phase.code: phase for phase in Phase.objects.filter(
        code__in=codes).prefetch_related('slots__default_exercise')}
    return _render(request, 'plans', {
        'plans': Plan.objects.filter(profile=get_active_profile(request)).select_related('phase'),
        'phase_templates': [available[code] for code in codes if code in available],
    })


@profile_required
def plan_create(request):
    initial = {}
    try:
        phase_id = int(request.GET.get('phase', ''))
    except (TypeError, ValueError):
        phase_id = None
    phase = Phase.objects.filter(pk=phase_id, code__in=('AA', 'SM', 'WM', 'WS', 'US')).first()
    preset = request.GET.get('preset') == '1'
    if phase:
        initial = {'name': phase.name, 'phase': phase.pk}
    form = PlanForm(request.POST if request.method == 'POST' else None, initial=initial)
    form.instance.profile = get_active_profile(request)
    if request.method == 'POST' and form.is_valid():
        p = form.save()
        url = reverse('plan_add', args=[p.pk])
        return redirect(url + '?preset=1' if preset and p.phase.slots.exists() else url)
    return _form(request, form, 'Nowy plan', reverse('plans'), description=(
        'Gotowy zestaw zawiera ćwiczenia i parametry wybranej fazy. '
        'Po zapisaniu nazwy sprawdzisz warianty i zatwierdzisz wybrane pozycje.'
        if preset else 'Wybierz fazę, a następnie dodaj przypisane do niej ćwiczenia.'))


def _plan(request, pk):
    return get_object_or_404(Plan.objects.select_related('phase'), pk=pk, profile=get_active_profile(request))


@profile_required
def plan_edit(request, pk):
    p = _plan(request, pk)
    form = PlanForm(request.POST if request.method == 'POST' else None, instance=p)
    # Changing the phase does not discard manually selected plan items.
    if request.method == 'POST' and form.is_valid():
        old_phase = Plan.objects.get(pk=p.pk).phase_id
        p = form.save()
        if old_phase != p.phase_id:
            p.items.update(overridden=True, slot=None)
        messages.success(request, 'Zapisano plan. Zachowano dotychczasowe pozycje. '
                         'Ćwiczenia nowej fazy dodasz przyciskiem „Dodaj ćwiczenia”; '
                         'gotowy zestaw znajdziesz na liście planów.')
        return redirect('plan_detail', pk=p.pk)
    return _form(request, form, 'Edytuj plan', reverse('plan_detail', args=[p.pk]))


def _reps_label(prescription):
    """Keep source '+' only while its numeric bounds still describe the plan."""
    original = prescription.reps_original
    numbers = [int(n) for n in re.findall(r'\d+', original)]
    low, high = prescription.reps_min, prescription.reps_max
    source_bounds = (numbers[0], numbers[-1]) if numbers else None
    bounds = (low, high if high is not None else low)
    if source_bounds == bounds:
        return original
    if low is None:
        return 'Brak danych'
    return str(low) + (f'–{high}' if high is not None and high != low else '')


def _plan_detail(request, p, start_form=None):
    start_form = start_form or StartWorkoutForm()
    day = timezone.localdate()
    if start_form.is_bound and start_form.is_valid():
        day = start_form.cleaned_data['date']
    profile = get_active_profile(request)
    body = BodyWeight.objects.filter(profile=profile, date__lte=day).order_by('-date', '-pk').first()
    items = []
    for item in p.items.select_related('exercise', 'slot').order_by('position', 'pk'):
        rm = OneRepMax.objects.filter(profile=profile, exercise=item.exercise, date__lte=day).order_by('-date', '-pk').first()
        prescription = {f: getattr(item, f) for f in PRESCRIPTION_FIELDS}
        load = calculate_load(prescription, rm=rm.value if rm else None, body=body.value if body else None, step=profile.rounding_step)
        goal = None
        if item.parameter_code == 'SM':
            source_goal = StrengthGoal.objects.filter(phase=p.phase, exercise=item.exercise).first()
            goal = calculate_goal(source_goal, body=body.value if body else None, step=profile.rounding_step)
        items.append({'item': item, 'load': load, 'end_goal': goal, 'reps_label': _reps_label(item)})
    return _render(request, 'plan_detail', {'plan': p, 'items': items, 'start_form': start_form,
        'has_missing': any(i['load'].get('missing') for i in items),
        'recommendations_count': Recommendation.objects.filter(phase=p.phase).count() + p.phase.slots.count()})


@profile_required
def plan_detail(request, pk):
    return _plan_detail(request, _plan(request, pk))


@profile_required
def plan_add(request, pk):
    p = _plan(request, pk)
    has_slots = p.phase.slots.exists()
    form_type = AddPhaseSlotsForm if has_slots else AddExercisesForm
    preset = request.GET.get('preset') == '1'
    options = {'plan': p}
    if has_slots:
        options['preselect'] = preset
    form = form_type(request.POST if request.method == 'POST' else None, **options)
    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            Plan.objects.select_for_update().get(pk=p.pk)
            last = p.items.order_by('-position').first()
            position = last.position + 1 if last else 1
            if has_slots:
                for slot, exercise, chosen_sets in form.cleaned_data['selections']:
                    values = {f: getattr(slot, f) for f in PRESCRIPTION_FIELDS}
                    if slot.series_load_mode == 'endpoints':
                        values['chosen_sets'] = chosen_sets
                    item = PlanItem(plan=p, slot=slot, exercise=exercise, position=position, **values)
                    item.full_clean()
                    item.save()
                    position += 1
            else:
                for rec in form.cleaned_data['recommendations']:
                    PlanItem.objects.create(plan=p, exercise=rec.exercise, position=position,
                        **{f: getattr(rec, f) for f in PRESCRIPTION_FIELDS})
                    position += 1
        messages.success(request, 'Dodano wybrane ćwiczenia.')
        return redirect('plan_detail', pk=p.pk)
    return _render(request, 'plan_add', {'plan': p, 'form': form,
        'has_slots': has_slots, 'slot_rows': form.slot_rows() if has_slots else [], 'preset': preset,
        'recommendations': Recommendation.objects.filter(phase=p.phase).select_related('exercise')})


def _item(request, pk):
    return get_object_or_404(PlanItem.objects.select_related('plan', 'exercise'), pk=pk,
                           plan__profile=get_active_profile(request))


@profile_required
def plan_item_edit(request, pk):
    item = _item(request, pk)
    form = PlanItemForm(request.POST if request.method == 'POST' else None, instance=item)
    if request.method == 'POST' and form.is_valid():
        item = form.save(commit=False)
        item.overridden = True
        item.save()
        messages.success(request, 'Zapisano własne parametry tej pozycji planu.')
        return redirect('plan_detail', pk=item.plan_id)
    source = f'Źródłowy zestaw parametrów: {item.parameter_code}. ' if item.parameter_code else ''
    return _form(request, form, f'Parametry: {item.exercise.name}', reverse('plan_detail', args=[item.plan_id]),
        description=source + 'Zmiany dotyczą wyłącznie tego planu i będą oznaczone jako ustawienie własne. Zmiana wariantu użyje jego własnego 1RM.')


@require_POST
@profile_required
def plan_item_move(request, pk, direction):
    item = _item(request, pk)
    if direction not in ('up', 'down'):
        return HttpResponse(status=400)
    with transaction.atomic():
        Plan.objects.select_for_update().get(pk=item.plan_id)
        items = list(item.plan.items.order_by('position', 'pk'))
        index = next(i for i, x in enumerate(items) if x.pk == item.pk)
        target = index - 1 if direction == 'up' else index + 1
        if 0 <= target < len(items):
            items[index], items[target] = items[target], items[index]
        # Temporary unique positions avoid collisions on constrained order fields.
        for i, x in enumerate(items):
            PlanItem.objects.filter(pk=x.pk).update(position=1000000 + i)
        for i, x in enumerate(items):
            PlanItem.objects.filter(pk=x.pk).update(position=i + 1)
    return redirect('plan_detail', pk=item.plan_id)


@require_POST
@profile_required
def plan_item_delete(request, pk):
    item = _item(request, pk)
    p = item.plan_id
    item.delete()
    return redirect('plan_detail', pk=p)


@require_POST
@profile_required
def plan_start(request, pk):
    p = _plan(request, pk)
    form = StartWorkoutForm(request.POST)
    if form.is_valid():
        if not p.items.exists():
            form.add_error(None, 'Dodaj co najmniej jedno ćwiczenie do planu.')
        else:
            try:
                session = start_workout(p, date=form.cleaned_data['date'])
            except ValidationError as exc:
                form.add_error(None, exc)
            else:
                return redirect('workout', pk=session.pk)
    return _plan_detail(request, p, form)


@profile_required
def history(request):
    return _render(request, 'history', {'workouts': Workout.objects.filter(profile=get_active_profile(request)).order_by('-training_date', '-started_at')})


@profile_required
def workout(request, pk):
    session = get_object_or_404(Workout, pk=pk, profile=get_active_profile(request))
    return _render(request, 'workout', {'workout': session, 'initial_workout': serialize_workout(session)})


@profile_required
def exercise_list(request):
    return _render(request, 'exercises', {'exercises': Exercise.objects.all().order_by('name')})


@profile_required
def exercise_detail(request, pk):
    exercise = get_object_or_404(Exercise, pk=pk)
    profile = get_active_profile(request)
    action = request.POST.get('action', 'manual') if request.method == 'POST' else None
    form = OneRepMaxForm(request.POST if request.method == 'POST' and action == 'manual' else None)
    calculator_form = EstimateRMForm(request.POST if request.method == 'POST' and action in ('estimate', 'save_estimate') else None)
    estimate = None
    form.instance.profile = profile
    form.instance.exercise = exercise
    if request.method == 'POST' and action == 'manual' and form.is_valid():
        form.save()
        messages.success(request, 'Zapisano ręczny pomiar 1RM. Wyniki serii nie zmieniają 1RM.')
        return redirect('exercise_detail', pk=exercise.pk)
    if request.method == 'POST' and action in ('estimate', 'save_estimate') and calculator_form.is_valid():
        data = calculator_form.cleaned_data
        try:
            estimate = estimate_rm(data['weight'], data['reps'])
        except ValidationError as exc:
            calculator_form.add_error(None, exc)
        else:
            if action == 'save_estimate':
                record = OneRepMax(profile=profile, exercise=exercise, value=estimate,
                    date=data['date'], is_estimated=True,
                    source_weight=data['weight'], source_reps=data['reps'])
                record.full_clean()
                record.save()
                messages.success(request, 'Świadomie zapisano szacowaną wartość 1RM. Zwykłe serie treningowe nie zmieniają 1RM.')
                return redirect('exercise_detail', pk=exercise.pk)
    entries = WorkoutExercise.objects.filter(exercise=exercise, workout__profile=profile,
        workout__status='completed').select_related('workout').prefetch_related(Prefetch(
            'sets', queryset=WorkoutSet.objects.filter(deleted=False).order_by('number'), to_attr='history_sets',
        )).order_by('workout__training_date', 'workout__started_at')
    records = []
    for entry in entries:
        sets = entry.history_sets
        if not sets:
            continue
        record_mode = entry.snapshot.get('mode', exercise.mode)
        records.append({'workout': entry.workout, 'sets': sets, 'mode': record_mode})
    return _render(request, 'exercise_detail', {'exercise': exercise, 'form': form,
        'calculator_form': calculator_form, 'estimate': estimate,
        'estimate_weight': calculator_form.cleaned_data.get('weight') if estimate is not None else None,
        'estimate_reps': calculator_form.cleaned_data.get('reps') if estimate is not None else None,
        'estimate_coefficient': ({4: '0,900', 5: '0,875', 6: '0,850', 7: '0,825', 8: '0,800', 9: '0,775', 10: '0,750'}.get(calculator_form.cleaned_data.get('reps')) if estimate is not None else None),
        'rm_history': OneRepMax.objects.filter(profile=profile, exercise=exercise).order_by('-date', '-pk'),
        'history': list(reversed(records)), 'progress': exercise_progress(profile, exercise)})


@profile_required
def settings(request):
    profile = get_active_profile(request)
    form = SettingsForm(request.POST if request.method == 'POST' else None, instance=profile)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Zapisano ustawienia profilu.')
        return redirect('settings')
    return _render(request, 'settings', {'form': form})


def _serialized(queryset):
    return json.loads(serializers.serialize('json', queryset))


@profile_required
def export_json(request):
    profile = get_active_profile(request)
    data = {'schema_version': 2, 'exported_at': timezone.now().isoformat(),
        'profile': _serialized(Profile.objects.filter(pk=profile.pk)),
        'body_weights': _serialized(BodyWeight.objects.filter(profile=profile)),
        'one_rep_max': _serialized(OneRepMax.objects.filter(profile=profile)),
        'exercises': _serialized(Exercise.objects.all()),
        'phases': _serialized(Phase.objects.all()),
        'phase_slots': _serialized(PhaseSlot.objects.all()),
        'strength_goals': _serialized(StrengthGoal.objects.all()),
        'recommendations': _serialized(Recommendation.objects.all()),
        'plans': _serialized(Plan.objects.filter(profile=profile)),
        'plan_items': _serialized(PlanItem.objects.filter(plan__profile=profile)),
        'workouts': _serialized(Workout.objects.filter(profile=profile)),
        'workout_exercises': _serialized(WorkoutExercise.objects.filter(workout__profile=profile)),
        'sets': _serialized(WorkoutSet.objects.filter(workout_exercise__workout__profile=profile))}
    response = HttpResponse(json.dumps(data, ensure_ascii=False, indent=2), content_type='application/json; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="profil-{profile.pk}.json"'
    return response


@profile_required
def export_csv(request):
    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="wyniki-treningow.csv"'
    response.write('\ufeff')
    writer = csv.writer(response, delimiter=';')
    writer.writerow(['Data treningu', 'Rozpoczęcie sesji', 'Plan', 'Faza', 'Status', 'Ćwiczenie', 'Seria', 'Ciężar kg', 'Powtórzenia', 'Czas s', 'Notatka'])
    rows = WorkoutSet.objects.filter(workout_exercise__workout__profile=get_active_profile(request),
        deleted=False).select_related('workout_exercise__workout', 'workout_exercise__exercise').order_by('workout_exercise__workout__training_date', 'workout_exercise__workout__started_at', 'workout_exercise__position', 'number')
    for row in rows:
        ex = row.workout_exercise
        session = ex.workout
        # Prefix formula-like text to keep spreadsheet import inert.
        def safe(text):
            text = str(text)
            return "'" + text if text.startswith(('=', '+', '-', '@', '\t', '\r')) else text
        writer.writerow([session.training_date.isoformat(), session.started_at.isoformat(), safe(session.plan_name), safe(session.phase_name),
            session.status, safe(ex.snapshot.get('name', ex.exercise.name)), row.number, row.weight,
            '' if row.reps is None else row.reps, '' if row.seconds is None else row.seconds, safe(row.note)])
    return response
