from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
"""The supplied phase exercises must be discoverable before a plan exists."""
from django.test import TestCase
from django.urls import reverse

from training.models import Phase, Plan, PlanItem, Profile
from training.services import prescription_data


class ReadyPhaseTemplateTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='tester', email='tester@example.test')
        EmailAddress.objects.create(user=self.user, email=self.user.email, verified=True, primary=True)
        self.client.force_login(self.user)
        self.profile = Profile.objects.create(owner=self.user, name='Gotowe zestawy — test')
        session = self.client.session
        session['active_profile_id'] = self.profile.pk
        session.save()

    def plan(self, code):
        phase = Phase.objects.get(code=code)
        return Plan.objects.create(profile=self.profile, phase=phase, name=f'Plan {code}')

    def template_create_url(self, code):
        phase = Phase.objects.get(code=code)
        return reverse('plan_create') + f'?phase={phase.pk}&preset=1'

    def template_add_url(self, plan):
        return reverse('plan_add', args=[plan.pk]) + '?preset=1'

    @staticmethod
    def selected_values(slots, count=2):
        values = {}
        for slot in slots:
            values[f'select_{slot.pk}'] = 'on'
            values[f'exercise_{slot.pk}'] = str(slot.default_exercise_id)
            if slot.series_load_mode == 'endpoints':
                values[f'sets_{slot.pk}'] = str(count)
        return values

    def test_source_phase_cards_are_visible_without_any_saved_plan(self):
        response = self.client.get(reverse('plans'))
        self.assertEqual(response.status_code, 200)
        templates = list(response.context['phase_templates'])
        self.assertEqual([phase.code for phase in templates], ['AA', 'SM', 'WM', 'WS', 'US'])
        self.assertEqual([phase.slots.count() for phase in templates], [8, 6, 6, 6, 6])
        for phase in templates:
            self.assertContains(response, f'id="phase-template-{phase.code}"')
            self.assertContains(response, phase.name)
            self.assertContains(response, reverse('plan_create') + f'?phase={phase.pk}&amp;preset=1')
        self.assertEqual(Plan.objects.count(), 0)
        self.assertEqual(PlanItem.objects.count(), 0)

    def test_catalog_includes_ready_exercise_names(self):
        response = self.client.get(reverse('plans'))
        self.assertContains(response, 'Przysiad')
        self.assertContains(response, 'Wypychanie nogami')
        self.assertContains(response, 'Wiosłowanie na siedząco')
        self.assertContains(response, 'Skłony ze skrętem')
        self.assertContains(response, 'Uginanie nóg leżąc')

    def test_template_link_prefills_form_without_creating_a_plan(self):
        phase = Phase.objects.get(code='SM')
        response = self.client.get(self.template_create_url('SM'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(str(response.context['form']['phase'].value()), str(phase.pk))
        self.assertIn('SM', response.context['form']['name'].value())
        self.assertEqual(Plan.objects.count(), 0)
        self.assertEqual(PlanItem.objects.count(), 0)

    def test_invalid_phase_query_is_ignored_without_server_error(self):
        for phase_id in ('not-a-number', '99999999'):
            with self.subTest(phase_id=phase_id):
                response = self.client.get(reverse('plan_create') + f'?phase={phase_id}&preset=1')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(Plan.objects.count(), 0)

    def test_saving_prefilled_plan_opens_preselected_source_exercises(self):
        phase = Phase.objects.get(code='AA')
        response = self.client.post(self.template_create_url('AA'), {
            'name': 'Mój gotowy zestaw AA', 'phase': str(phase.pk),
        })
        plan = Plan.objects.get(profile=self.profile)
        self.assertRedirects(response, self.template_add_url(plan))
        self.assertEqual(plan.phase_id, phase.pk)
        self.assertEqual(plan.items.count(), 0)

    def test_template_selection_checks_all_remaining_positions_with_default_variants(self):
        plan = self.plan('AA')
        response = self.client.get(self.template_add_url(plan))
        self.assertEqual(response.status_code, 200)
        form = response.context['form']
        slots = list(plan.phase.slots.order_by('position'))
        for slot in slots:
            field = form[f'select_{slot.pk}']
            self.assertTrue(field.value())
            self.assertIn('checked', str(field))
            self.assertEqual(str(form[f'exercise_{slot.pk}'].value()), str(slot.default_exercise_id))
        self.assertNotEqual(slots[0].default_exercise_id, slots[2].default_exercise_id)
        self.assertEqual(plan.items.count(), 0)

    def test_regular_add_flow_still_requires_user_selection(self):
        plan = self.plan('AA')
        response = self.client.get(reverse('plan_add', args=[plan.pk]))
        for slot in plan.phase.slots.all():
            self.assertFalse(response.context['form'][f'select_{slot.pk}'].value())

    def test_preselection_does_not_add_unsubmitted_positions(self):
        plan = self.plan('WS')
        first = plan.phase.slots.get(position=1)
        helper = plan.phase.slots.get(position=3)
        # Reversed POST order must still follow the supplied source order.
        response = self.client.post(self.template_add_url(plan), self.selected_values([helper, first]))
        self.assertRedirects(response, reverse('plan_detail', args=[plan.pk]))
        items = list(plan.items.all())
        self.assertEqual([item.slot.position for item in items], [1, 3])
        self.assertEqual([item.parameter_code for item in items], ['WS', 'AA'])
        self.assertEqual([item.exercise_id for item in items], [first.default_exercise_id, helper.default_exercise_id])

    def test_us_default_count_is_visible_and_three_sets_can_be_chosen(self):
        plan = self.plan('US')
        slot = plan.phase.slots.get(position=1)
        response = self.client.get(self.template_add_url(plan))
        self.assertEqual(str(response.context['form'][f'sets_{slot.pk}'].value()), '2')
        response = self.client.post(self.template_add_url(plan), self.selected_values([slot], count=3))
        self.assertRedirects(response, reverse('plan_detail', args=[plan.pk]))
        item = plan.items.get()
        self.assertEqual(item.chosen_sets, 3)
        self.assertIsNone(item.middle_weight)

    def test_remaining_template_positions_do_not_duplicate_existing_plan_items(self):
        plan = self.plan('AA')
        first = plan.phase.slots.get(position=1)
        original = PlanItem.objects.create(plan=plan, slot=first,
            exercise=first.default_exercise, position=1, **prescription_data(first))
        response = self.client.get(self.template_add_url(plan))
        form = response.context['form']
        self.assertNotIn(f'select_{first.pk}', form.fields)
        remaining = list(plan.phase.slots.exclude(pk=first.pk).order_by('position'))
        for slot in remaining:
            self.assertTrue(form[f'select_{slot.pk}'].value())
        response = self.client.post(self.template_add_url(plan), self.selected_values(remaining))
        self.assertRedirects(response, reverse('plan_detail', args=[plan.pk]))
        self.assertEqual(plan.items.count(), 8)
        self.assertTrue(plan.items.filter(pk=original.pk).exists())

    def test_empty_template_submission_keeps_selection_empty_and_shows_error(self):
        plan = self.plan('AA')
        response = self.client.post(self.template_add_url(plan), {})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context['form'].errors)
        for slot in plan.phase.slots.all():
            self.assertFalse(response.context['form'][f'select_{slot.pk}'].value())
        self.assertEqual(plan.items.count(), 0)
