"""Reguły biznesowe: bez połączeń sieciowych i bez zastępowania asercji makietami."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import TestCase

from training.models import (
    BodyWeight,
    Exercise,
    OneRepMax,
    Phase,
    Plan,
    PlanItem,
    Profile,
    SyncReceipt,
    Workout,
    WorkoutSet,
)
from training.services import apply_operations, calculate_load, serialize_workout, start_workout


class LoadCalculationTests(TestCase):
    def test_percent_of_rm_uses_rm_not_body(self):
        result = calculate_load(
            {"basis": "rm", "percent_min": "60"},
            rm=Decimal("100"), body=Decimal("80"), step=Decimal("2.5"),
        )
        self.assertEqual(Decimal(result["min"]), Decimal("60"))
        self.assertEqual(Decimal(result["max"]), Decimal("60"))
        self.assertFalse(result["missing"])
        self.assertIn("1RM", result["explanation"])

    def test_percent_of_body_uses_body_not_rm(self):
        result = calculate_load(
            {"basis": "body", "percent_min": "50"},
            rm=Decimal("100"), body=Decimal("80"), step=Decimal("1"),
        )
        self.assertEqual(Decimal(result["min"]), Decimal("40"))
        self.assertNotIn("1RM", result["explanation"])

    def test_percent_range_and_configurable_rounding(self):
        result = calculate_load(
            {"basis": "rm", "percent_min": "61", "percent_max": "69"},
            rm=Decimal("100"), step=Decimal("2.5"),
        )
        self.assertEqual(Decimal(result["min"]), Decimal("60"))
        self.assertEqual(Decimal(result["max"]), Decimal("70"))
        fine = calculate_load(
            {"basis": "rm", "percent_min": "61"},
            rm=Decimal("100"), step=Decimal("0.5"),
        )
        self.assertEqual(Decimal(fine["min"]), Decimal("61"))

    def test_missing_required_source_is_not_zero(self):
        for prescription in (
            {"basis": "rm", "percent_min": "60"},
            {"basis": "body", "percent_min": "60"},
            {"basis": "rm"},
            {"basis": "fixed"},
            {"basis": ""},
        ):
            with self.subTest(prescription=prescription):
                result = calculate_load(prescription)
                self.assertIsNone(result["min"])
                self.assertIsNone(result["max"])
                self.assertTrue(result["missing"])

    def test_fixed_and_explicit_no_load(self):
        fixed = calculate_load({"basis": "fixed", "fixed_weight": "12.5"}, step=Decimal("2.5"))
        self.assertEqual(Decimal(fixed["min"]), Decimal("12.5"))
        unloaded = calculate_load({"basis": "none"})
        self.assertFalse(unloaded["missing"])


class WorkoutRulesTests(TestCase):
    def setUp(self):
        self.profile = Profile.objects.create(name="Pierwsza osoba", rounding_step=Decimal("2.5"))
        self.other = Profile.objects.create(name="Druga osoba")
        self.phase = Phase.objects.create(name="Testowa faza — nie zalecenia Friela")
        self.squat = Exercise.objects.create(name="Przysiad testowy", mode="reps")
        self.plank = Exercise.objects.create(name="Deska testowa", mode="time")
        self.plan = Plan.objects.create(profile=self.profile, name="Plan testowy", phase=self.phase)
        self.squat_item = PlanItem.objects.create(
            plan=self.plan, exercise=self.squat, position=2,
            sets_min=3, reps_min=8, basis="rm", percent_min=Decimal("60"), rest_seconds=90,
        )
        self.plank_item = PlanItem.objects.create(
            plan=self.plan, exercise=self.plank, position=1,
            sets_min=2, seconds=30, basis="none", rest_seconds=45,
        )
        self.day = date(2025, 4, 10)
        self.body = BodyWeight.objects.create(profile=self.profile, date=date(2025, 4, 1), value="80")
        self.rm = OneRepMax.objects.create(profile=self.profile, exercise=self.squat, date=date(2025, 4, 2), value="100")

    def start(self):
        return start_workout(self.plan, date=self.day)

    def upsert(self, exercise, *, set_id=None, weight="50", reps=8, seconds=None, note=""):
        return {
            "id": str(uuid4()), "type": "set.upsert", "exercise_id": str(exercise.pk),
            "set": {"id": str(set_id or uuid4()), "weight": weight, "reps": reps, "seconds": seconds, "note": note},
        }

    def test_plan_order_is_copied_to_session(self):
        workout = self.start()
        self.assertEqual(list(workout.exercises.values_list("exercise_id", flat=True)), [self.plank.pk, self.squat.pk])
        self.assertEqual(serialize_workout(workout)["exercises"][0]["snapshot"]["name"], self.plank.name)

    def test_latest_measurements_as_of_training_date_only(self):
        BodyWeight.objects.create(profile=self.profile, date=date(2025, 4, 11), value="99")
        OneRepMax.objects.create(profile=self.profile, exercise=self.squat, date=date(2025, 4, 11), value="200")
        BodyWeight.objects.create(profile=self.other, date=date(2025, 4, 9), value="120")
        OneRepMax.objects.create(profile=self.other, exercise=self.squat, date=date(2025, 4, 9), value="300")
        workout = self.start()
        self.assertEqual(workout.body_weight, Decimal("80"))
        self.assertEqual(workout.body_weight_date, date(2025, 4, 1))
        snapshot = workout.exercises.get(exercise=self.squat).snapshot
        self.assertEqual(Decimal(snapshot["load"]["min"]), Decimal("60"))

    def test_no_measurements_retains_missing_not_zero(self):
        self.rm.delete()
        self.body.delete()
        workout = self.start()
        self.assertIsNone(workout.body_weight)
        snapshot = workout.exercises.get(exercise=self.squat).snapshot
        self.assertIsNone(snapshot["load"]["min"])
        self.assertTrue(snapshot["load"]["missing"])

    def test_set_numbering_is_independent_for_each_exercise(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        plank = workout.exercises.get(exercise=self.plank)
        apply_operations(workout, [self.upsert(squat), self.upsert(squat), self.upsert(plank, reps=None, seconds=30, weight="0")])
        self.assertEqual(list(squat.sets.filter(deleted=False).values_list("number", flat=True)), [1, 2])
        self.assertEqual(list(plank.sets.filter(deleted=False).values_list("number", flat=True)), [1])

    def test_same_operation_retry_does_not_duplicate_series(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        operation = self.upsert(squat)
        apply_operations(workout, [operation])
        apply_operations(workout, [operation])
        self.assertEqual(squat.sets.filter(deleted=False).count(), 1)
        self.assertEqual(SyncReceipt.objects.filter(workout=workout, pk=operation["id"]).count(), 1)

    def test_same_series_uuid_update_does_not_insert_another_series(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        series_id = uuid4()
        apply_operations(workout, [self.upsert(squat, set_id=series_id, weight="50")])
        apply_operations(workout, [self.upsert(squat, set_id=series_id, weight="55", reps=7)])
        self.assertEqual(squat.sets.filter(deleted=False).count(), 1)
        saved = WorkoutSet.objects.get(pk=series_id)
        self.assertEqual(saved.weight, Decimal("55"))
        self.assertEqual(saved.reps, 7)

    def test_negative_values_and_wrong_recording_mode_are_rejected(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        plank = workout.exercises.get(exercise=self.plank)
        for operation in (
            self.upsert(squat, weight="-1"),
            self.upsert(squat, reps=-1),
            self.upsert(plank, reps=None, seconds=-10),
            self.upsert(squat, reps=None, seconds=30),
            self.upsert(plank, reps=8, seconds=None),
        ):
            with self.subTest(operation=operation), self.assertRaises(ValidationError):
                apply_operations(workout, [operation])
        self.assertEqual(WorkoutSet.objects.count(), 0)

    def test_exercise_from_another_profile_cannot_be_written_into_session(self):
        workout = self.start()
        other_plan = Plan.objects.create(profile=self.other, name="Cudzy plan", phase=self.phase)
        PlanItem.objects.create(plan=other_plan, exercise=self.squat, position=1)
        other_workout = start_workout(other_plan, date=self.day)
        foreign_exercise = other_workout.exercises.get()
        with self.assertRaises(ValidationError):
            apply_operations(workout, [self.upsert(foreign_exercise)])
        self.assertEqual(WorkoutSet.objects.count(), 0)

    def test_finish_blocks_new_sets_but_accepts_acknowledged_retries(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        operation = self.upsert(squat)
        finish = {"id": str(uuid4()), "type": "finish"}
        apply_operations(workout, [operation, finish])
        workout.refresh_from_db()
        self.assertEqual(workout.status, "completed")
        self.assertIsNotNone(workout.finished_at)
        apply_operations(workout, [operation, finish])
        with self.assertRaises(ValidationError):
            apply_operations(workout, [self.upsert(squat)])
        self.assertEqual(squat.sets.filter(deleted=False).count(), 1)

    def test_snapshot_survives_plan_and_rm_changes(self):
        workout = self.start()
        before = workout.exercises.get(exercise=self.squat).snapshot.copy()
        self.squat_item.percent_min = Decimal("90")
        self.squat_item.reps_min = 2
        self.squat_item.save()
        self.plan.name = "Zmieniona nazwa"
        self.plan.save()
        self.rm.value = Decimal("200")
        self.rm.save()
        self.body.value = Decimal("70")
        self.body.save()
        self.squat.name = "Zmieniona nazwa ćwiczenia"
        self.squat.save()
        workout.refresh_from_db()
        self.assertEqual(workout.exercises.get(exercise=self.squat).snapshot, before)
        self.assertEqual(workout.plan_name, "Plan testowy")
        self.assertEqual(workout.body_weight, Decimal("80"))
        self.assertEqual(Decimal(before["load"]["min"]), Decimal("60"))

    def test_recorded_series_never_overwrites_manual_one_rm(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        apply_operations(workout, [self.upsert(squat, weight="150", reps=5)])
        self.rm.refresh_from_db()
        self.assertEqual(self.rm.value, Decimal("100"))
        self.assertEqual(OneRepMax.objects.filter(profile=self.profile, exercise=self.squat).count(), 1)

    def test_prepare_uuid_is_idempotent(self):
        workout_id = uuid4()
        first = start_workout(self.plan, date=self.day, workout_id=workout_id)
        again = start_workout(self.plan, date=self.day, workout_id=workout_id)
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(Workout.objects.filter(pk=workout_id).count(), 1)
        self.assertEqual(first.exercises.count(), 2)

    def test_prescription_rejects_inverted_range(self):
        self.squat_item.sets_min = 5
        self.squat_item.sets_max = 3
        with self.assertRaises(ValidationError):
            self.squat_item.full_clean()

    def test_sync_batch_is_atomic_if_later_operation_is_invalid(self):
        workout = self.start()
        squat = workout.exercises.get(exercise=self.squat)
        valid = self.upsert(squat)
        invalid = self.upsert(squat, weight="-1")
        with self.assertRaises(ValidationError):
            apply_operations(workout, [valid, invalid])
        self.assertEqual(squat.sets.count(), 0)
        self.assertEqual(SyncReceipt.objects.filter(workout=workout).count(), 0)

    def test_other_profile_cannot_reuse_workout_uuid(self):
        workout = self.start()
        other_plan = Plan.objects.create(profile=self.other, name="Cudzy plan", phase=self.phase)
        PlanItem.objects.create(plan=other_plan, exercise=self.squat, position=1)
        with self.assertRaises(ValidationError):
            start_workout(other_plan, date=self.day, workout_id=workout.pk)
        self.assertEqual(Workout.objects.filter(profile=self.other).count(), 0)

    def test_previous_results_are_scoped_to_same_profile(self):
        previous = start_workout(self.plan, date=date(2025, 4, 5))
        own_exercise = previous.exercises.get(exercise=self.squat)
        apply_operations(previous, [
            self.upsert(own_exercise, weight="51", reps=7),
            {"id": str(uuid4()), "type": "finish"},
        ])
        other_plan = Plan.objects.create(profile=self.other, name="Cudzy plan", phase=self.phase)
        PlanItem.objects.create(plan=other_plan, exercise=self.squat, position=1)
        other_session = start_workout(other_plan, date=date(2025, 4, 9))
        foreign_exercise = other_session.exercises.get()
        apply_operations(other_session, [
            self.upsert(foreign_exercise, weight="222", reps=2),
            {"id": str(uuid4()), "type": "finish"},
        ])
        current = self.start()
        results = current.exercises.get(exercise=self.squat).snapshot["previous_results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(Decimal(results[0]["weight"]), Decimal("51"))
        self.assertEqual(results[0]["reps"], 7)
