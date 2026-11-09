"""Actual session maxima for the active person's exercise history.

A point represents one completed workout, even when an exercise appeared in
more than one position of that workout. Nothing here estimates or updates 1RM.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Prefetch
from django.urls import reverse
from django.utils import timezone

from .models import WorkoutExercise, WorkoutSet


LEFT, RIGHT = 70, 690
TOP, BOTTOM = 30, 235
DAY_SECONDS = Decimal(86400)


def _text(value):
    return format(Decimal(str(value)).normalize(), 'f')


def _display(value):
    return _text(value).replace('.', ',')


def _time_coordinate(workout):
    """Use the selected training day plus actual local session time on that day."""
    started = workout.started_at
    if timezone.is_aware(started):
        started = timezone.localtime(started)
    seconds = Decimal(started.hour * 3600 + started.minute * 60 + started.second)
    seconds += Decimal(started.microsecond) / Decimal(1000000)
    return Decimal(workout.training_date.toordinal()) + seconds / DAY_SECONDS


def _tick_step(maximum, unit):
    desired = (maximum if maximum > 0 else Decimal(1)) / 4
    magnitude = Decimal(10) ** desired.adjusted()
    fraction = desired / magnitude
    nice = next(value for value in map(Decimal, ('1', '2', '2.5', '3', '4', '5', '10')) if value >= fraction)
    step = nice * magnitude
    return max(step, Decimal(1)) if unit == 's' else step


def _x_ticks(points, stamps):
    if not points:
        return []
    first, last = stamps[0], stamps[-1]
    if first == last:
        return [{'x': (LEFT + RIGHT) / 2, 'label': points[0]['label'], 'anchor': 'middle'}]
    same_day = points[0]['date'] == points[-1]['date']
    day_span = (date.fromisoformat(points[-1]['date']) - date.fromisoformat(points[0]['date'])).days
    count = 2 if same_day else min(3, day_span + 1)
    ticks = []
    for index in range(count):
        stamp = first + (last - first) * index / (count - 1)
        day = date.fromordinal(int(stamp))
        if same_day:
            seconds = int(((stamp - int(stamp)) * DAY_SECONDS).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            clock = datetime.combine(day, datetime.min.time()) + timedelta(seconds=seconds)
            label = clock.strftime('%d.%m %H:%M:%S' if (last - first) * DAY_SECONDS < 60 else '%d.%m %H:%M')
        else:
            label = day.strftime('%d.%m.%Y')
        ticks.append({'x': round(LEFT + float((stamp - first) / (last - first)) * (RIGHT - LEFT), 2),
                      'label': label, 'anchor': 'start' if index == 0 else 'end' if index == count - 1 else 'middle'})
    return ticks


def exercise_progress(profile, exercise):
    """Return JSON-friendly plot data and labels, scoped to one profile.

    Decimal values are used for selecting maxima and axis bounds. Floats are
    emitted only for SVG coordinates and numeric values consumed by the client.
    """
    unit = 's' if exercise.mode == 'time' else 'kg'
    entries = WorkoutExercise.objects.filter(
        exercise=exercise, workout__profile=profile, workout__status='completed',
    ).select_related('workout').prefetch_related(Prefetch(
        'sets', queryset=WorkoutSet.objects.filter(deleted=False), to_attr='recorded_sets',
    )).order_by('workout__training_date', 'workout__started_at', 'workout_id', 'position')
    sessions = {}
    for entry in entries:
        if entry.snapshot.get('mode', exercise.mode) != exercise.mode:
            continue
        recorded = [row for row in entry.recorded_sets
                    if (row.seconds is not None if unit == 's' else row.reps is not None)]
        if not recorded:
            continue
        key = (lambda row: (row.seconds,)) if unit == 's' else (lambda row: (row.weight, row.reps))
        best = max(recorded, key=key)
        current = sessions.get(entry.workout_id)
        if current is None or key(best) > key(current[1]):
            sessions[entry.workout_id] = (entry.workout, best)

    points, stamps, values = [], [], []
    for workout, best in sessions.values():
        value = Decimal(best.seconds) if unit == 's' else best.weight
        values.append(value)
        stamps.append(_time_coordinate(workout))
        detail = f'{best.seconds} s' if unit == 's' else f'{_display(best.weight)} kg × {best.reps} powt.'
        local_start = timezone.localtime(workout.started_at) if timezone.is_aware(workout.started_at) else workout.started_at
        points.append({
            'id': str(workout.pk), 'date': workout.training_date.isoformat(),
            'label': workout.training_date.strftime('%d.%m.%Y'),
            'time_label': local_start.strftime('%H:%M'),
            'datetime_label': f'{workout.training_date:%d.%m.%Y} {local_start:%H:%M}',
            'timestamp': workout.started_at.isoformat(),
            'value': float(value), 'value_label': _text(value),
            'weight': _text(best.weight) if unit == 'kg' else None,
            'reps': best.reps if unit == 'kg' else None,
            'seconds': best.seconds if unit == 's' else None,
            'detail': detail, 'url': reverse('workout', args=[workout.pk]),
        })

    # Actual times can differ from the selected training date. The coordinates
    # and point order both use that selected date and then the session time.
    ordered = sorted(zip(stamps, values, points), key=lambda row: (row[0], row[2]['timestamp'], row[2]['id']))
    stamps = [row[0] for row in ordered]
    values = [row[1] for row in ordered]
    points = [row[2] for row in ordered]
    step = _tick_step(max(values, default=Decimal(0)), unit)
    ceiling = step * 4
    for point, value, stamp in zip(points, values, stamps):
        ratio = (stamp - stamps[0]) / (stamps[-1] - stamps[0]) if stamps[-1] != stamps[0] else Decimal('0.5')
        point['x'] = round(LEFT + float(ratio) * (RIGHT - LEFT), 2)
        point['y'] = round(BOTTOM - float(value / ceiling) * (BOTTOM - TOP), 2)

    summary = {'count': len(points), 'first': None, 'last': None, 'best': None,
               'change': None, 'change_label': None}
    if points:
        best_index = max(range(len(points)), key=lambda index: (values[index], points[index]['reps'] or 0, index))
        change = values[-1] - values[0]
        summary.update(first=points[0], last=points[-1], best=points[best_index],
                       change=float(change), change_label=f'{"+" if change > 0 else ""}{_display(change)} {unit}')
    return {
        'points': points,
        'y_ticks': [{'y': round(BOTTOM - index / 4 * (BOTTOM - TOP), 2), 'label': _display(step * index)} for index in range(5)],
        'x_ticks': _x_ticks(points, stamps),
        'chart_line': ' '.join(f'{point["x"]:.2f},{point["y"]:.2f}' for point in points),
        'unit': unit,
        'metric_label': 'Maksymalny czas w sesji' if unit == 's' else 'Maksymalny ciężar w sesji',
        'summary': summary,
    }
