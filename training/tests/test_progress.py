from datetime import date, datetime, time
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from training.models import Exercise, OneRepMax, Profile, Workout, WorkoutExercise, WorkoutSet
from training.progress import exercise_progress


class ExerciseProgressTests(TestCase):
    def setUp(self):
        self.profile = Profile.objects.create(name='Wykres osoby pierwszej')
        self.other = Profile.objects.create(name='Wykres drugiej osoby')
        self.exercise = Exercise.objects.create(name='Ćwiczenie wykresu', mode='reps')
        self.timed = Exercise.objects.create(name='Ćwiczenie wykresu na czas', mode='time')

    def workout(self, day, *, profile=None, status='completed', hour=12):
        return Workout.objects.create(profile=profile or self.profile, plan_name='Plan wykresu', phase_name='Test',
            training_date=day, started_at=timezone.make_aware(datetime.combine(day, time(hour))), status=status)

    def row(self, workout, *, weight='50', reps=8, seconds=None, exercise=None, position=1, mode=None, deleted=False):
        exercise = exercise or self.exercise
        entry, _ = WorkoutExercise.objects.get_or_create(workout=workout, position=position,
            defaults={'exercise': exercise, 'snapshot': {'mode': mode or exercise.mode}})
        return WorkoutSet.objects.create(workout_exercise=entry, number=entry.sets.count() + 1,
            weight=Decimal(weight), reps=reps, seconds=seconds, deleted=deleted)

    def test_maximum_is_one_point_per_session_across_repeated_positions(self):
        workout = self.workout(date(2026, 1, 1))
        self.row(workout, weight='50', reps=12)
        self.row(workout, weight='70', reps=5)
        self.row(workout, weight='80', reps=3, position=2)
        result = exercise_progress(self.profile, self.exercise)
        self.assertEqual(len(result['points']), 1)
        self.assertEqual(result['points'][0]['value'], 80)
        self.assertEqual(result['points'][0]['reps'], 3)
        self.assertEqual(result['points'][0]['detail'], '80 kg × 3 powt.')

    def test_weight_ties_retain_the_highest_repetition_context(self):
        workout = self.workout(date(2026, 1, 1))
        self.row(workout, weight='62.50', reps=4)
        self.row(workout, weight='62.50', reps=8)
        point = exercise_progress(self.profile, self.exercise)['points'][0]
        self.assertEqual(point['reps'], 8)
        self.assertEqual(point['weight'], '62.5')

    def test_active_deleted_other_profile_and_other_exercise_are_excluded(self):
        valid = self.workout(date(2026, 1, 1))
        self.row(valid, weight='40')
        self.row(valid, weight='99', deleted=True)
        self.row(self.workout(date(2026, 1, 2), status='active'), weight='100')
        self.row(self.workout(date(2026, 1, 3), profile=self.other), weight='200')
        self.row(self.workout(date(2026, 1, 4)), exercise=self.timed, weight='300', seconds=30)
        points = exercise_progress(self.profile, self.exercise)['points']
        self.assertEqual([point['value'] for point in points], [40])

    def test_historical_mode_does_not_mix_seconds_into_weight(self):
        self.row(self.workout(date(2026, 1, 1)), weight='100', mode='time', seconds=30)
        self.row(self.workout(date(2026, 1, 2)), weight='60', mode='reps')
        points = exercise_progress(self.profile, self.exercise)['points']
        self.assertEqual([point['value'] for point in points], [60])

    def test_missing_result_is_not_replaced_with_zero(self):
        self.row(self.workout(date(2026, 1, 1)), weight='100', reps=None)
        result = exercise_progress(self.profile, self.exercise)
        self.assertEqual(result['points'], [])
        self.assertEqual(result['summary']['count'], 0)
        self.assertIsNone(result['summary']['best'])

    def test_time_exercise_uses_max_seconds_without_weight_statistics(self):
        workout = self.workout(date(2026, 1, 1))
        self.row(workout, exercise=self.timed, weight='50', reps=None, seconds=30)
        self.row(workout, exercise=self.timed, weight='0', reps=None, seconds=65)
        self.row(self.workout(date(2026, 1, 2)), exercise=self.timed, weight='90', reps=None, seconds=None)
        result = exercise_progress(self.profile, self.timed)
        self.assertEqual(result['unit'], 's')
        self.assertEqual(result['points'][0]['value'], 65)
        self.assertEqual(result['points'][0]['detail'], '65 s')
        self.assertIsNone(result['points'][0]['weight'])
        self.assertIsNone(result['points'][0]['reps'])

    def test_dates_are_ordered_and_x_spacing_reflects_elapsed_time(self):
        for day, weight in [(date(2026, 1, 11), '80'), (date(2026, 1, 1), '50'), (date(2026, 1, 2), '60')]:
            self.row(self.workout(day), weight=weight)
        result = exercise_progress(self.profile, self.exercise)
        points = result['points']
        self.assertEqual([point['date'] for point in points], ['2026-01-01', '2026-01-02', '2026-01-11'])
        first_gap = points[1]['x'] - points[0]['x']
        second_gap = points[2]['x'] - points[1]['x']
        self.assertAlmostEqual(second_gap / first_gap, 9)
        self.assertEqual(result['summary']['change'], 30)
        self.assertEqual(result['summary']['best']['value'], 80)

    def test_single_point_and_zero_weight_have_valid_coordinates(self):
        self.row(self.workout(date(2026, 1, 1)), weight='0', reps=10)
        result = exercise_progress(self.profile, self.exercise)
        self.assertEqual(result['points'][0]['x'], 380)
        self.assertEqual(result['points'][0]['y'], 235)
        self.assertEqual(result['points'][0]['value'], 0)
        self.assertEqual(len(result['y_ticks']), 5)
        self.assertEqual(len(result['x_ticks']), 1)
        self.assertEqual(result['summary']['change_label'], '0 kg')

    def test_negative_change_compares_last_session_to_first_not_to_record(self):
        for day, weight in [(1, '50.25'), (2, '80'), (3, '40.15')]:
            self.row(self.workout(date(2026, 1, day)), weight=weight)
        result = exercise_progress(self.profile, self.exercise)
        self.assertEqual(result['summary']['change_label'], '-10,1 kg')
        self.assertEqual(result['summary']['best']['value'], 80)

    def test_same_day_sessions_remain_separate_and_ordered(self):
        late = self.workout(date(2026, 1, 1), hour=18)
        early = self.workout(date(2026, 1, 1), hour=8)
        self.row(late, weight='75')
        self.row(early, weight='65')
        result = exercise_progress(self.profile, self.exercise)
        points = result['points']
        self.assertEqual([point['id'] for point in points], [str(early.pk), str(late.pk)])
        self.assertLess(points[0]['x'], points[1]['x'])
        self.assertEqual([tick['label'] for tick in result['x_ticks']], ['01.01 08:00', '01.01 18:00'])

    def test_progress_does_not_create_or_modify_rm_measurements(self):
        rm = OneRepMax.objects.create(profile=self.profile, exercise=self.exercise, date=date(2026, 1, 1), value='100')
        self.row(self.workout(date(2026, 1, 2)), weight='110', reps=3)
        exercise_progress(self.profile, self.exercise)
        rm.refresh_from_db()
        self.assertEqual(rm.value, Decimal('100'))
        self.assertEqual(OneRepMax.objects.filter(profile=self.profile).count(), 1)

    def test_series_are_loaded_without_a_query_per_workout(self):
        for day in range(1, 5):
            self.row(self.workout(date(2026, 1, day)), weight='50')
        with self.assertNumQueries(2):
            result = exercise_progress(self.profile, self.exercise)
        self.assertEqual(len(result['points']), 4)
