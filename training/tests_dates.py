import uuid
from datetime import timedelta
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from .models import Exercise, Phase, Plan, PlanItem, Profile
from .services import apply_operations, start_workout


class OfflineFinishDateTests(TestCase):
    def setUp(self):
        profile = Profile.objects.create(name='Dates')
        phase = Phase.objects.create(name='DEMO dates')
        exercise = Exercise.objects.create(name='DEMO dates', mode='reps')
        self.plan = Plan.objects.create(profile=profile, phase=phase, name='Dates')
        PlanItem.objects.create(plan=self.plan, exercise=exercise, basis='none')
        self.workout = start_workout(self.plan)
        self.workout.started_at = timezone.now() - timedelta(hours=2)
        self.workout.save(update_fields=['started_at'])

    def finish(self, value):
        return apply_operations(self.workout, [{'id': str(uuid.uuid4()), 'type': 'finish', 'finished_at': value}])

    def test_offline_finish_preserves_actual_end_instead_of_sync_time(self):
        end = timezone.now() - timedelta(hours=1)
        result = self.finish(end.isoformat())
        self.workout.refresh_from_db()
        self.assertEqual(self.workout.finished_at, end)
        self.assertEqual(result['status'], 'completed')

    def test_invalid_end_dates_leave_workout_active(self):
        values = [
            (self.workout.started_at - timedelta(seconds=1)).isoformat(),
            (timezone.now() + timedelta(hours=1)).isoformat(),
            '2026-01-01T10:00:00',
            'not-a-date',
            None,
        ]
        for value in values:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.finish(value)
        self.workout.refresh_from_db()
        self.assertEqual(self.workout.status, 'active')

    def test_selected_training_date_does_not_shift_actual_session_start(self):
        selected = timezone.localdate() - timedelta(days=8)
        before = timezone.now()
        historical = start_workout(self.plan, date=selected)
        after = timezone.now()
        self.assertEqual(historical.training_date, selected)
        self.assertGreaterEqual(historical.started_at, before)
        self.assertLessEqual(historical.started_at, after)
        result = apply_operations(historical, [{'id': str(uuid.uuid4()), 'type': 'finish'}])
        self.assertEqual(result['training_date'], selected.isoformat())
        historical.refresh_from_db()
        self.assertLess((historical.finished_at - historical.started_at).total_seconds(), 10)

    def test_future_training_date_still_allows_actual_session_finish(self):
        selected = timezone.localdate() + timedelta(days=8)
        future = start_workout(self.plan, date=selected)
        result = apply_operations(future, [{'id': str(uuid.uuid4()), 'type': 'finish'}])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['training_date'], selected.isoformat())
