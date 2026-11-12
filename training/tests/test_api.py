from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
import json
import uuid
from datetime import date

from django.test import Client, TestCase
from django.urls import reverse

from training.models import Exercise, Phase, Plan, PlanItem, Profile, Workout, WorkoutSet
from training.services import start_workout


class SyncApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='tester', email='tester@example.test')
        EmailAddress.objects.create(user=self.user, email=self.user.email, verified=True, primary=True)
        self.client.force_login(self.user)
        self.profile = Profile.objects.create(owner=self.user, name='Pierwszy')
        self.other = Profile.objects.create(owner=self.user, name='Drugi')
        self.phase = Phase.objects.create(name='DEMO')
        self.exercise = Exercise.objects.create(name='Przysiad testowy')
        self.plan = Plan.objects.create(profile=self.profile, phase=self.phase, name='Testowy')
        PlanItem.objects.create(plan=self.plan, exercise=self.exercise, position=1, basis='fixed', fixed_weight=20)
        self.workout = start_workout(self.plan)
        self.url = reverse('api_sync', args=[self.workout.pk])

    def operation(self, **changes):
        op = {'id': str(uuid.uuid4()), 'type': 'set.upsert',
              'exercise_id': str(self.workout.exercises.first().pk),
              'set': {'id': str(uuid.uuid4()), 'weight': '22.50', 'reps': 8, 'note': ''}}
        op.update(changes)
        return op

    def send(self, operations, client=None):
        return (client or self.client).post(self.url, {'operations': operations}, content_type='application/json')

    def test_post_requires_csrf_and_token_allows_sync(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        op = self.operation()
        self.assertEqual(self.send([op], client).status_code, 403)
        token = client.get(reverse('api_csrf')).json()['csrfToken']
        response = client.post(self.url, {'operations': [op]}, content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['acknowledged'], [op['id']])

    def test_replayed_upsert_and_finish_do_not_duplicate(self):
        op = self.operation()
        finish = {'id': str(uuid.uuid4()), 'type': 'finish'}
        for _ in range(2):
            response = self.send([op, finish])
            self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(WorkoutSet.objects.count(), 1)
        response = self.send([self.operation()])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(WorkoutSet.objects.count(), 1)

    def test_cross_profile_reads_writes_and_prepare_are_hidden(self):
        session = self.client.session
        session['active_profile_id'] = self.other.pk
        session.save()
        self.assertEqual(self.client.get(reverse('api_workout', args=[self.workout.pk])).status_code, 404)
        self.assertEqual(self.send([self.operation()]).status_code, 404)
        self.assertEqual(self.client.get(reverse('workout', args=[self.workout.pk])).status_code, 404)
        response = self.client.post(reverse('api_prepare', args=[self.plan.pk]), {'workout_id': str(uuid.uuid4())}, content_type='application/json')
        self.assertEqual(response.status_code, 404)

    def test_prepare_retry_returns_same_snapshot(self):
        workout_id = str(uuid.uuid4())
        data = {'workout_id': workout_id, 'date': date.today().isoformat()}
        first = self.client.post(reverse('api_prepare', args=[self.plan.pk]), data, content_type='application/json')
        self.assertEqual(first.status_code, 200, first.content)
        item = self.plan.items.first()
        item.fixed_weight = 90
        item.save()
        second = self.client.post(reverse('api_prepare', args=[self.plan.pk]), data, content_type='application/json')
        self.assertEqual(second.json(), first.json())
        self.assertEqual(Workout.objects.filter(pk=workout_id).count(), 1)

    def test_negative_input_rejected_and_entire_batch_rolled_back(self):
        bad = self.operation()
        bad['set']['weight'] = '-1'
        response = self.send([self.operation(), bad])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(WorkoutSet.objects.count(), 0)

    def test_invalid_json_returns_bad_request(self):
        self.assertEqual(self.client.post(self.url, 'invalid', content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post(self.url, json.dumps({'operations': [1]}), content_type='application/json').status_code, 400)

    def test_recording_a_set_restores_a_previously_skipped_exercise(self):
        op = self.operation()
        skip = {'id': str(uuid.uuid4()), 'type': 'skip', 'exercise_id': op['exercise_id'], 'skipped': True}
        response = self.send([skip, op])
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['workout']['exercises'][0]['skipped'])

    def test_readonly_routes_do_not_mutate_via_get(self):
        self.assertEqual(self.client.get(self.url).status_code, 405)
        self.assertEqual(self.client.get(reverse('plan_item_delete', args=[self.plan.items.first().pk])).status_code, 405)

    def test_exports_contain_only_selected_profile(self):
        other_plan = Plan.objects.create(profile=self.other, name='PRYWATNY-DRUGI', phase=self.phase)
        PlanItem.objects.create(plan=other_plan, exercise=self.exercise, position=1)
        start_workout(other_plan)
        response = self.client.get(reverse('export_json'))
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'PRYWATNY-DRUGI')
        self.assertEqual(len(response.json()['workouts']), 1)
