from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from .models import Exercise, Phase, Plan, PlanItem, Profile, Workout, WorkoutExercise, WorkoutSet, SyncReceipt
from .services import start_workout


class HistoricalAdminTests(TestCase):
    def test_superuser_can_view_but_cannot_modify_historical_models(self):
        user = get_user_model().objects.create_superuser(username='audit', password='test-only')
        self.client.force_login(user)
        profile = Profile.objects.create(name='Audit')
        phase = Phase.objects.create(name='Audit')
        exercise = Exercise.objects.create(name='Audit')
        plan = Plan.objects.create(profile=profile, phase=phase, name='Audit')
        PlanItem.objects.create(plan=plan, exercise=exercise, basis='none')
        workout = start_workout(plan)
        url = reverse('admin:training_workout_change', args=[workout.pk])
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.post(url, {'plan_name': 'Tampered', '_save': 'Save'}).status_code, 403)
        workout.refresh_from_db()
        self.assertEqual(workout.plan_name, 'Audit')
        request = self.client.get(url).wsgi_request
        for model in [Workout, WorkoutExercise, WorkoutSet, SyncReceipt]:
            with self.subTest(model=model.__name__):
                model_admin = admin.site._registry[model]
                self.assertFalse(model_admin.has_add_permission(request))
                self.assertFalse(model_admin.has_change_permission(request))
                self.assertFalse(model_admin.has_delete_permission(request))
