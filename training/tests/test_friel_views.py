from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from training.models import BodyWeight, OneRepMax, Phase, Plan, Profile


class FrielWorkflowViewTests(TestCase):
    def setUp(self):
        self.profile = Profile.objects.create(name='Test faz Friela')
        session = self.client.session
        session['active_profile_id'] = self.profile.pk
        session.save()

    def plan(self, code):
        return Plan.objects.create(profile=self.profile, phase=Phase.objects.get(code=code), name=f'Plan {code}')

    def selection(self, *slots, variants=None, count=2):
        variants = variants or {}
        data = {}
        for slot in slots:
            data[f'select_{slot.pk}'] = 'on'
            data[f'exercise_{slot.pk}'] = str(variants.get(slot.pk, slot.default_exercise_id))
            if slot.series_load_mode == 'endpoints':
                data[f'sets_{slot.pk}'] = str(count)
        return data

    def test_add_shows_categories_and_variants_but_detail_only_selected_items(self):
        plan = self.plan('AA')
        slots = list(plan.phase.slots.order_by('position'))
        add = self.client.get(reverse('plan_add', args=[plan.pk]))
        self.assertEqual(add.status_code, 200)
        self.assertContains(add, slots[0].title)
        self.assertContains(add, slots[-1].title)
        self.assertEqual(self.client.post(reverse('plan_add', args=[plan.pk]), self.selection(slots[0], slots[1])).status_code, 302)
        self.assertEqual(list(plan.items.values_list('slot__position', flat=True)), [1, 2])
        detail = self.client.get(reverse('plan_detail', args=[plan.pk]))
        self.assertNotContains(detail, slots[5].default_exercise.name)

    def test_anatomical_adaptation_requires_different_hip_variants(self):
        plan = self.plan('AA')
        first = plan.phase.slots.get(position=1)
        second = plan.phase.slots.get(position=3)
        data = self.selection(first, second, variants={second.pk: first.default_exercise_id})
        response = self.client.post(reverse('plan_add', args=[plan.pk]), data)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context['form'].errors)
        self.assertEqual(plan.items.count(), 0)

    def test_foreign_variant_cannot_be_added_to_a_slot(self):
        plan = self.plan('AA')
        hip = plan.phase.slots.get(position=1)
        shoulder = plan.phase.slots.get(position=4)
        response = self.client.post(reverse('plan_add', args=[plan.pk]), self.selection(hip, variants={hip.pk: shoulder.default_exercise_id}))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context['form'].errors)
        self.assertEqual(plan.items.count(), 0)

    def test_plan_keeps_source_order_and_distinct_parameter_sets(self):
        plan = self.plan('WS')
        slots = list(plan.phase.slots.order_by('position'))
        # POST ordering must not replace source ordering.
        response = self.client.post(reverse('plan_add', args=[plan.pk]), self.selection(slots[2], slots[0]))
        self.assertEqual(response.status_code, 302)
        main, helper = list(plan.items.all())
        self.assertEqual((main.slot.position, helper.slot.position), (1, 3))
        self.assertEqual((main.parameter_code, main.reps_min, main.reps_max), ('WS', 40, 60))
        self.assertEqual((helper.parameter_code, helper.reps_min, helper.reps_max), ('AA', 20, 30))

    def test_maintenance_count_is_an_explicit_plan_choice(self):
        plan = self.plan('US')
        slot = plan.phase.slots.get(position=1)
        response = self.client.post(reverse('plan_add', args=[plan.pk]), self.selection(slot, count=3))
        self.assertEqual(response.status_code, 302)
        item = plan.items.get()
        self.assertEqual(item.chosen_sets, 3)
        self.assertIsNone(item.middle_weight)

    def test_maintenance_rejects_other_set_count(self):
        plan = self.plan('US')
        slot = plan.phase.slots.get(position=1)
        response = self.client.post(reverse('plan_add', args=[plan.pk]), self.selection(slot, count=4))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context['form'].errors)
        self.assertEqual(plan.items.count(), 0)

    def test_estimate_preview_does_not_save_and_confirmation_is_marked_estimated(self):
        exercise = Phase.objects.get(code='AA').slots.get(position=1).default_exercise
        url = reverse('exercise_detail', args=[exercise.pk])
        data = {'weight': '80', 'reps': '8', 'date': timezone.localdate().isoformat(), 'action': 'estimate', 'at_limit': 'on'}
        response = self.client.post(url, data)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(OneRepMax.objects.filter(profile=self.profile).exists())
        data['action'] = 'save_estimate'
        response = self.client.post(url, data)
        self.assertEqual(response.status_code, 302)
        rm = OneRepMax.objects.get(profile=self.profile, exercise=exercise)
        self.assertEqual(rm.value, Decimal('100'))
        self.assertTrue(rm.is_estimated)
        self.assertEqual(rm.source_weight, Decimal('80'))
        self.assertEqual(rm.source_reps, 8)

    def test_estimator_rejects_unlisted_repetitions_even_on_confirmation(self):
        exercise = Phase.objects.get(code='AA').slots.get(position=1).default_exercise
        response = self.client.post(reverse('exercise_detail', args=[exercise.pk]), {
            'weight': '80', 'reps': '11', 'date': timezone.localdate().isoformat(), 'action': 'save_estimate', 'at_limit': 'on'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(OneRepMax.objects.filter(profile=self.profile).exists())

    def test_estimator_requires_confirmation_that_attempt_was_at_limit(self):
        exercise = Phase.objects.get(code='AA').slots.get(position=1).default_exercise
        response = self.client.post(reverse('exercise_detail', args=[exercise.pk]), {
            'weight': '80', 'reps': '8', 'date': timezone.localdate().isoformat(), 'action': 'save_estimate'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('at_limit', response.context['calculator_form'].errors)
        self.assertFalse(OneRepMax.objects.filter(profile=self.profile).exists())

    def test_export_contains_phase_slot_and_goal_definitions(self):
        response = self.client.get(reverse('export_json'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['phase_slots']), 32)
        self.assertEqual(len(response.json()['strength_goals']), 3)
