import csv
import json
from collections import defaultdict
from functools import wraps
from django.contrib import messages
from django.core import serializers
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST
from .forms import (AddExercisesForm, BodyWeightForm, OneRepMaxForm, PlanForm,
                    PlanItemForm, PRESCRIPTION_FIELDS, ProfileForm, SettingsForm, StartWorkoutForm)
from .models import (BodyWeight, Exercise, OneRepMax, Phase, Plan, PlanItem, Profile,
                     Recommendation, Workout, WorkoutExercise, WorkoutSet)
from .services import calculate_load, serialize_workout, start_workout


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
    return _render(request, 'plans', {'plans': Plan.objects.filter(profile=get_active_profile(request)).select_related('phase')})


@profile_required
def plan_create(request):
    form = PlanForm(request.POST if request.method == 'POST' else None)
    form.instance.profile = get_active_profile(request)
    if request.method == 'POST' and form.is_valid():
        p = form.save()
        return redirect('plan_add', pk=p.pk)
    return _form(request, form, 'Nowy plan', reverse('plans'))


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
            p.items.update(overridden=True)
        messages.success(request, 'Zapisano plan. Zachowano dotychczasowe pozycje.')
        return redirect('plan_detail', pk=p.pk)
    return _form(request, form, 'Edytuj plan', reverse('plan_detail', args=[p.pk]))


def _plan_detail(request, p, start_form=None):
    start_form = start_form or StartWorkoutForm()
    day = timezone.localdate()
    if start_form.is_bound and start_form.is_valid():
        day = start_form.cleaned_data['date']
    profile = get_active_profile(request)
    body = BodyWeight.objects.filter(profile=profile, date__lte=day).order_by('-date', '-pk').first()
    items = []
    for item in p.items.select_related('exercise').order_by('position', 'pk'):
        rm = OneRepMax.objects.filter(profile=profile, exercise=item.exercise, date__lte=day).order_by('-date', '-pk').first()
        prescription = {f: getattr(item, f) for f in PRESCRIPTION_FIELDS}
        load = calculate_load(prescription, rm=rm.value if rm else None, body=body.value if body else None, step=profile.rounding_step)
        items.append({'item': item, 'load': load})
    return _render(request, 'plan_detail', {'plan': p, 'items': items, 'start_form': start_form,
        'has_missing': any(i['load'].get('missing') for i in items),
        'recommendations_count': Recommendation.objects.filter(phase=p.phase).count()})


@profile_required
def plan_detail(request, pk):
    return _plan_detail(request, _plan(request, pk))


@profile_required
def plan_add(request, pk):
    p = _plan(request, pk)
    form = AddExercisesForm(request.POST if request.method == 'POST' else None, plan=p)
    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            Plan.objects.select_for_update().get(pk=p.pk)
            last = p.items.order_by('-position').first()
            position = last.position + 1 if last else 1
            for rec in form.cleaned_data['recommendations']:
                PlanItem.objects.create(plan=p, exercise=rec.exercise, position=position,
                    **{f: getattr(rec, f) for f in PRESCRIPTION_FIELDS})
                position += 1
        messages.success(request, 'Dodano wybrane ćwiczenia.')
        return redirect('plan_detail', pk=p.pk)
    return _render(request, 'plan_add', {'plan': p, 'form': form,
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
    return _form(request, form, f'Parametry: {item.exercise.name}', reverse('plan_detail', args=[item.plan_id]))


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
    form = OneRepMaxForm(request.POST if request.method == 'POST' else None)
    form.instance.profile = profile
    form.instance.exercise = exercise
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Zapisano ręczny pomiar 1RM. Wyniki serii nie zmieniają 1RM.')
        return redirect('exercise_detail', pk=exercise.pk)
    entries = WorkoutExercise.objects.filter(exercise=exercise, workout__profile=profile,
        workout__status='completed').select_related('workout').order_by('workout__training_date', 'workout__started_at')
    records = []
    points = []
    for entry in entries:
        sets = list(WorkoutSet.objects.filter(workout_exercise=entry, deleted=False).order_by('number'))
        if not sets:
            continue
        record_mode = entry.snapshot.get('mode', exercise.mode)
        records.append({'workout': entry.workout, 'sets': sets, 'mode': record_mode})
        if record_mode != exercise.mode:
            continue
        if record_mode == 'time':
            best = max(sets, key=lambda x: x.seconds or 0)
            value = best.seconds or 0
            detail = f'{value} s'
        else:
            best = max(sets, key=lambda x: (x.weight or 0, x.reps or 0))
            value = float(best.weight or 0)
            detail = f'{best.weight} kg × {best.reps} powt.'
        points.append({'value': float(value), 'detail': detail, 'label': entry.workout.training_date.strftime('%d.%m.%Y')})
    maximum = max([p['value'] for p in points], default=1) or 1
    for index, point in enumerate(points):
        point.update(x=40 + (index / max(len(points) - 1, 1)) * 520,
                     y=170 - point['value'] / maximum * 130)
    return _render(request, 'exercise_detail', {'exercise': exercise, 'form': form,
        'rm_history': OneRepMax.objects.filter(profile=profile, exercise=exercise).order_by('-date', '-pk'),
        'history': list(reversed(records)), 'plot_points': points,
        'chart_line': ' '.join(f"{p['x']:.1f},{p['y']:.1f}" for p in points),
        'max_value': maximum})


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
    data = {'schema_version': 1, 'exported_at': timezone.now().isoformat(),
        'profile': _serialized(Profile.objects.filter(pk=profile.pk)),
        'body_weights': _serialized(BodyWeight.objects.filter(profile=profile)),
        'one_rep_max': _serialized(OneRepMax.objects.filter(profile=profile)),
        'exercises': _serialized(Exercise.objects.all()),
        'phases': _serialized(Phase.objects.all()),
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
