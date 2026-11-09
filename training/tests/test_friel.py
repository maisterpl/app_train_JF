"""Regressions against the supplied transcription of tables 13.1–13.7."""
import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from training.friel_data import seed_friel
from training.models import (BodyWeight, Exercise, OneRepMax, Phase, PhaseSlot,
                             Plan, PlanItem, Profile, StrengthGoal, Workout)
from training.services import (apply_operations, calculate_goal, calculate_load,
                               estimate_rm, prescription_data, start_workout)


class SuppliedProgramDataTests(TestCase):
    def test_exact_phase_names_and_session_ranges(self):
        expected = {
            'AA': ('adaptacja anatomiczna', 8, 12, 2, 3, False),
            'SM': ('siła maksymalna', 8, 12, 2, 3, False),
            'WM': ('wytrzymałość mocy', 6, 8, 1, 2, False),
            'WS': ('wytrzymałość siłowa', 4, 8, 1, 1, False),
            'US': ('utrzymanie siły', None, None, 1, 1, True),
        }
        self.assertEqual(set(Phase.objects.exclude(code=None).values_list('code', flat=True)), set(expected))
        self.assertFalse(Phase.objects.filter(code='MT').exists())
        for code, (name, low, high, weekly_low, weekly_high, unlimited) in expected.items():
            with self.subTest(code=code):
                phase = Phase.objects.get(code=code)
                self.assertEqual(phase.name, f'{code} — {name}')
                self.assertFalse(phase.is_demo)
                self.assertEqual((phase.sessions_min, phase.sessions_max), (low, high))
                self.assertEqual((phase.weekly_min, phase.weekly_max), (weekly_low, weekly_high))
                self.assertEqual(phase.sessions_unlimited, unlimited)
                self.assertIn('13.1', phase.source)

    def test_ordered_positions_are_distinct_from_variants(self):
        self.assertEqual(PhaseSlot.objects.count(), 32)
        aa = Phase.objects.get(code='AA')
        slots = list(aa.slots.select_related('default_exercise'))
        self.assertEqual([s.position for s in slots], list(range(1, 9)))
        self.assertEqual([s.default_exercise.name for s in slots], [
            'Przysiad', 'Ściąganie do klatki piersiowej na siedząco',
            'Wypychanie nogami', 'Wyciskanie na ławce', 'Wiosłowanie na siedząco',
            'Uginanie nóg leżąc', 'Wiosłowanie na stojąco', 'Skłony ze skrętem',
        ])
        for hip in (slots[0], slots[2]):
            self.assertEqual(hip.category, 'hip')
            self.assertEqual(set(hip.allowed_exercises.values_list('name', flat=True)), {'Przysiad', 'Wypychanie nogami', 'Step'})
        self.assertEqual(slots[5].category, 'weakness')
        self.assertFalse(Exercise.objects.filter(name__iexact='Osobiste słabości').exists())
        for code in ('SM', 'WM', 'WS', 'US'):
            phase_slots = list(Phase.objects.get(code=code).slots.select_related('default_exercise'))
            self.assertEqual([s.position for s in phase_slots], list(range(1, 7)))
            self.assertEqual([s.default_exercise.name for s in phase_slots], [
                'Przysiad', 'Wiosłowanie na siedząco', 'Skłony ze skrętem',
                'Wyciskanie na ławce', 'Uginanie nóg leżąc', 'Wiosłowanie na stojąco',
            ])

    def test_main_parameters_are_phase_specific_and_plus_is_preserved(self):
        expected = {
            'AA': (2, 5, 20, 30, '20–30', 40, 60, 'powoli', 60, 90),
            'SM': (2, 6, 3, 6, '3–6+', None, None, 'powoli do średnio', 120, 240),
            'WM': (2, 3, 8, 15, '8–15+', 40, 60, 'szybko', 180, 300),
            'WS': (1, 3, 40, 60, '40–60', 30, 50, 'średnio', 60, 120),
            'US': (2, 3, 6, 12, '6–12', None, None, 'średnio', 60, 120),
        }
        for code, values in expected.items():
            with self.subTest(code=code):
                slot = PhaseSlot.objects.get(phase__code=code, position=1)
                self.assertEqual((slot.sets_min, slot.sets_max, slot.reps_min, slot.reps_max,
                                  slot.reps_original, slot.percent_min, slot.percent_max,
                                  slot.tempo, slot.rest_seconds, slot.rest_seconds_max), values)
                self.assertEqual(slot.parameter_code, code)

    def test_helpers_keep_aa_in_all_other_phases(self):
        for code in ('SM', 'WM', 'WS', 'US'):
            for position in (3, 4, 5):
                with self.subTest(code=code, position=position):
                    slot = PhaseSlot.objects.get(phase__code=code, position=position)
                    self.assertEqual(slot.parameter_code, 'AA')
                    self.assertEqual((slot.sets_min, slot.sets_max), (2, 5))
                    self.assertEqual((slot.reps_min, slot.reps_max), (20, 30))
                    self.assertEqual((slot.percent_min, slot.percent_max), (40, 60))
                    self.assertEqual((slot.rest_seconds, slot.rest_seconds_max), (60, 90))
                    self.assertEqual(slot.tempo, 'powoli')
                    self.assertEqual(slot.series_load_mode, 'uniform')

    def test_only_three_supported_sm_goals_are_seeded(self):
        goals = {g.exercise.name: (g.multiplier_min, g.multiplier_max, g.target_reps)
                 for g in StrengthGoal.objects.filter(phase__code='SM').select_related('exercise')}
        self.assertEqual(goals, {
            'Przysiad': (Decimal('1.3'), Decimal('1.7'), 6),
            'Wiosłowanie na siedząco': (Decimal('0.5'), Decimal('0.8'), 6),
            'Wiosłowanie na stojąco': (Decimal('0.4'), Decimal('0.7'), 6),
        })
        self.assertEqual(StrengthGoal.objects.count(), 3)

    def test_core_keeps_source_range_but_does_not_assume_body_weight_is_rm(self):
        core = PhaseSlot.objects.get(phase__code='AA', position=8)
        self.assertEqual((core.percent_min, core.percent_max), (40, 60))
        self.assertEqual(core.basis, '')
        load = calculate_load(core, rm=100, body=80)
        self.assertIsNone(load['min'])
        self.assertTrue(load['missing'])

    def test_seed_is_repeatable_and_preserves_user_edits(self):
        slot = PhaseSlot.objects.get(phase__code='WM', position=1)
        slot.notes = 'Własna notatka administratora'
        slot.save(update_fields=['notes'])
        before = (Phase.objects.count(), Exercise.objects.count(), PhaseSlot.objects.count(), StrengthGoal.objects.count())
        seed_friel()
        seed_friel()
        after = (Phase.objects.count(), Exercise.objects.count(), PhaseSlot.objects.count(), StrengthGoal.objects.count())
        self.assertEqual(after, before)
        slot.refresh_from_db()
        self.assertEqual(slot.notes, 'Własna notatka administratora')


class FrielSessionRulesTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.profile = Profile.objects.create(name='Test faz', rounding_step=Decimal('1'))
        BodyWeight.objects.create(profile=self.profile, date=self.today, value=80)

    def plan(self, code):
        return Plan.objects.create(profile=self.profile, name=f'Plan {code}', phase=Phase.objects.get(code=code))

    def item(self, plan, position=1, variant=None, **changes):
        slot = plan.phase.slots.get(position=position)
        params = prescription_data(slot)
        params.update(changes)
        return PlanItem.objects.create(plan=plan, slot=slot, exercise=variant or slot.default_exercise,
                                       position=position, **params)

    def rm(self, exercise, value=100, date=None):
        return OneRepMax.objects.create(profile=self.profile, exercise=exercise, date=date or self.today, value=value)

    def test_sm_goal_is_separate_from_initial_planned_weight(self):
        plan = self.plan('SM')
        item = self.item(plan)
        self.rm(item.exercise, 120)
        snapshot = start_workout(plan).exercises.get().snapshot
        self.assertEqual((snapshot['end_goal']['min'], snapshot['end_goal']['max']), ('104', '136'))
        self.assertEqual(snapshot['end_goal']['target_reps'], 6)
        self.assertEqual(snapshot['rm'], '120')
        self.assertIsNone(snapshot['load']['min'])
        self.assertTrue(snapshot['load']['missing'])
        self.assertEqual(snapshot['phase_code'], 'SM')
        self.assertEqual(snapshot['parameter_code'], 'SM')

    def test_missing_goal_never_borrows_squat_multiplier(self):
        for name in ('Wypychanie nogami', 'Step'):
            with self.subTest(variant=name):
                plan = self.plan('SM')
                variant = Exercise.objects.get(name=name)
                self.item(plan, variant=variant)
                self.rm(variant, 200)
                snapshot = start_workout(plan).exercises.get().snapshot
                self.assertIsNone(snapshot['end_goal']['min'])
                self.assertTrue(snapshot['end_goal']['missing'])
                self.assertIsNone(snapshot['load']['min'])

    def test_helper_aa_has_no_sm_goal_and_uses_its_own_rm(self):
        plan = self.plan('SM')
        item = self.item(plan, position=4)
        self.rm(item.exercise, 50)
        snapshot = start_workout(plan).exercises.get().snapshot
        self.assertEqual(snapshot['parameter_code'], 'AA')
        self.assertEqual(snapshot['phase_code'], 'SM')
        self.assertEqual((snapshot['load']['min'], snapshot['load']['max']), ('20', '30'))
        self.assertIsNone(snapshot['end_goal'])

    def test_changed_variant_uses_own_dated_rm(self):
        plan = self.plan('WM')
        variant = Exercise.objects.get(name='Wypychanie nogami')
        item = self.item(plan, variant=variant)
        self.rm(Exercise.objects.get(name='Przysiad'), 100)
        self.rm(variant, 200, self.today - timedelta(days=1))
        self.rm(variant, 300, self.today + timedelta(days=1))
        snapshot = start_workout(plan).exercises.get().snapshot
        self.assertEqual(snapshot['exercise_id'], variant.pk)
        self.assertEqual(snapshot['rm'], '200')
        self.assertEqual((snapshot['load']['min'], snapshot['load']['max']), ('80', '120'))
        self.assertEqual(snapshot['reps_original'], '8–15+')

    def test_two_us_sets_have_distinct_sixty_and_eighty_percent_loads(self):
        plan = self.plan('US')
        item = self.item(plan, chosen_sets=2)
        self.rm(item.exercise, 100)
        snapshot = start_workout(plan).exercises.get().snapshot
        self.assertIsNone(snapshot['load']['min'])
        self.assertEqual([(r['number'], r['min'], r['max']) for r in snapshot['series_loads']], [(1, '60', '60'), (2, '80', '80')])
        self.assertTrue(all(not row['is_custom'] for row in snapshot['series_loads']))

    def test_three_us_sets_leave_middle_unknown_until_own_setting(self):
        plan = self.plan('US')
        item = self.item(plan, chosen_sets=3)
        self.rm(item.exercise)
        original = start_workout(plan).exercises.get().snapshot
        rows = original['series_loads']
        self.assertEqual([r['min'] for r in rows], ['60', None, '80'])
        self.assertTrue(rows[1]['is_custom'])
        self.assertTrue(rows[1]['missing'])
        item.middle_weight = Decimal('67.5')
        item.overridden = True
        item.save()
        updated = start_workout(plan).exercises.get().snapshot['series_loads']
        self.assertEqual(updated[1]['min'], '67.5')
        self.assertTrue(updated[1]['is_custom'])
        self.assertEqual(updated[1]['missing'], '')
        self.assertIsNone(rows[1]['min'], 'Starting another workout must not mutate an earlier snapshot')

    def test_us_requires_an_explicit_two_or_three_set_selection(self):
        for count in (None, 1, 4):
            with self.subTest(count=count):
                plan = self.plan('US')
                self.item(plan, chosen_sets=count)
                before = Workout.objects.count()
                with self.assertRaises(ValidationError):
                    start_workout(plan)
                self.assertEqual(Workout.objects.count(), before)

    def test_aa_cannot_start_with_same_variant_in_both_hip_positions(self):
        plan = self.plan('AA')
        squat = Exercise.objects.get(name='Przysiad')
        self.item(plan, position=1, variant=squat)
        self.item(plan, position=3, variant=squat)
        with self.assertRaises(ValidationError):
            start_workout(plan)
        self.assertFalse(Workout.objects.filter(plan=plan).exists())

    def test_slot_variant_and_phase_membership_are_checked_on_server(self):
        plan = self.plan('WM')
        invalid = self.item(plan, variant=Exercise.objects.get(name='Wyciskanie na ławce'))
        with self.assertRaises(ValidationError):
            start_workout(plan)
        invalid.delete()
        wrong_slot = PhaseSlot.objects.get(phase__code='WS', position=1)
        PlanItem.objects.create(plan=plan, slot=wrong_slot, exercise=wrong_slot.default_exercise, position=1)
        with self.assertRaises(ValidationError):
            start_workout(plan)

    def test_snapshot_preserves_goal_rm_and_parameters_after_source_changes(self):
        plan = self.plan('SM')
        item = self.item(plan)
        rm = self.rm(item.exercise)
        workout = start_workout(plan)
        original = workout.exercises.get().snapshot
        item.reps_original = 'Własne 4–5'
        item.tempo = 'Własne tempo'
        item.save()
        rm.value = 300
        rm.save()
        goal = StrengthGoal.objects.get(phase=plan.phase, exercise=item.exercise)
        goal.multiplier_min = 2
        goal.save()
        self.assertEqual(workout.exercises.get().snapshot, original)
        self.assertEqual(original['rm'], '100')
        self.assertEqual(original['reps_original'], '3–6+')
        self.assertEqual(original['end_goal']['multiplier_min'], '1.3')

    def test_series_logging_never_creates_or_replaces_rm(self):
        plan = self.plan('WM')
        item = self.item(plan)
        rm = self.rm(item.exercise, 100)
        workout = start_workout(plan)
        operation = {'id': str(uuid.uuid4()), 'type': 'set.upsert',
                     'exercise_id': str(workout.exercises.get().pk),
                     'set': {'id': str(uuid.uuid4()), 'weight': '80', 'reps': 8, 'note': ''}}
        apply_operations(workout, [operation])
        rm.refresh_from_db()
        self.assertEqual(rm.value, Decimal('100'))
        self.assertEqual(OneRepMax.objects.filter(profile=self.profile).count(), 1)

    def test_goal_without_body_measurement_stays_missing(self):
        goal = StrengthGoal.objects.get(phase__code='SM', exercise__name='Przysiad')
        output = calculate_goal(goal, body=None)
        self.assertIsNone(output['min'])
        self.assertTrue(output['missing'])
        self.assertEqual(output['multiplier_min'], '1.3')

    def test_goal_range_is_exact_and_not_narrowed_by_equipment_rounding(self):
        goal = StrengthGoal.objects.get(phase__code='SM', exercise__name='Przysiad')
        output = calculate_goal(goal, body=80, step=Decimal('2.5'))
        self.assertEqual((output['min'], output['max']), ('104', '136'))
        self.assertEqual((output['multiplier_min'], output['multiplier_max']), ('1.3', '1.7'))


class TableThirteenSevenEstimatorTests(TestCase):
    def test_all_supplied_coefficients_and_example(self):
        expected = {4: '0.900', 5: '0.875', 6: '0.850', 7: '0.825', 8: '0.800', 9: '0.775', 10: '0.750'}
        for reps, coefficient in expected.items():
            with self.subTest(reps=reps):
                trial_weight = Decimal(coefficient) * 100
                self.assertEqual(estimate_rm(trial_weight, reps), Decimal('100.00'))
        self.assertEqual(estimate_rm('80', 8), Decimal('100.00'))
        self.assertEqual(OneRepMax.objects.count(), 0)

    def test_out_of_table_reps_and_invalid_loads_are_rejected(self):
        for reps in (0, 3, 11, 8.5, None, True):
            with self.subTest(reps=reps), self.assertRaises(ValidationError):
                estimate_rm(80, reps)
        for weight in (0, -1, 'NaN', 'Infinity', None, 'incorrect'):
            with self.subTest(weight=weight), self.assertRaises(ValidationError):
                estimate_rm(weight, 8)

    def test_estimator_does_not_write_automatically(self):
        profile = Profile.objects.create(name='Oddzielny kalkulator')
        exercise = Exercise.objects.get(name='Przysiad')
        manual = OneRepMax.objects.create(profile=profile, exercise=exercise, value=90)
        self.assertEqual(estimate_rm(80, 8), Decimal('100.00'))
        manual.refresh_from_db()
        self.assertEqual(manual.value, 90)
        self.assertFalse(manual.is_estimated)
        self.assertEqual(OneRepMax.objects.filter(profile=profile).count(), 1)
