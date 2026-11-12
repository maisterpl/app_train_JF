from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from training.models import BodyWeight, Exercise, Phase, Plan, PlanItem, Profile, Recommendation, Workout


class PlanningViewTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='tester', email='tester@example.test')
        EmailAddress.objects.create(user=self.user, email=self.user.email, verified=True, primary=True)
        self.client.force_login(self.user)
        self.profile = Profile.objects.create(owner=self.user, name="Osoba testowa", rounding_step=Decimal("2.50"))
        self.other = Profile.objects.create(owner=self.user, name="Druga osoba")
        session = self.client.session
        session["active_profile_id"] = self.profile.pk
        session.save()
        self.phase = Phase.objects.create(name="Testowa faza", is_demo=True)
        self.empty_phase = Phase.objects.create(name="Joe Friel — Brak danych")
        self.exercises = [Exercise.objects.create(name=f"Testowe ćwiczenie {i}") for i in range(1, 4)]
        self.recommendations = [
            Recommendation.objects.create(phase=self.phase, exercise=exercise,
                sets_min=2, sets_max=3, reps_min=8, basis="fixed", fixed_weight=Decimal("15"))
            for exercise in self.exercises
        ]
        self.plan = Plan.objects.create(profile=self.profile, phase=self.phase, name="Wybrane ćwiczenia")

    def select(self, *recommendations):
        return self.client.post(reverse("plan_add", args=[self.plan.pk]), {
            "recommendations": [str(r.pk) for r in recommendations],
        })

    def test_duplicate_body_weight_is_form_error_and_preserves_value(self):
        today = timezone.localdate()
        BodyWeight.objects.create(profile=self.profile, date=today, value=Decimal("80"))
        response = self.client.post(reverse("profile_detail", args=[self.profile.pk]), {
            "date": today.isoformat(), "value": "81.25",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("date", response.context["form"].errors)
        self.assertEqual(response.context["form"]["value"].value(), "81.25")
        self.assertEqual(BodyWeight.objects.get(profile=self.profile, date=today).value, Decimal("80"))

    def test_invalid_profile_preserves_notes_and_does_not_create(self):
        response = self.client.post(reverse("profiles"), {"name": "", "notes": "Zachowaj tę uwagę"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("name", response.context["form"].errors)
        self.assertEqual(response.context["form"]["notes"].value(), "Zachowaj tę uwagę")
        self.assertEqual(Profile.objects.count(), 2)

    def test_plan_creation_requires_name_and_preserves_selected_phase(self):
        response = self.client.post(reverse("plan_create"), {"name": "", "phase": str(self.phase.pk)})
        self.assertEqual(response.status_code, 200)
        self.assertIn("name", response.context["form"].errors)
        self.assertEqual(response.context["form"]["phase"].value(), str(self.phase.pk))
        self.assertEqual(Plan.objects.filter(profile=self.profile).count(), 1)

    def test_only_selected_exercises_are_copied_and_shown(self):
        response = self.select(self.recommendations[0], self.recommendations[2])
        self.assertRedirects(response, reverse("plan_detail", args=[self.plan.pk]))
        items = list(self.plan.items.all())
        self.assertEqual([item.exercise_id for item in items], [self.exercises[0].pk, self.exercises[2].pk])
        self.assertEqual(items[0].fixed_weight, Decimal("15"))
        self.assertFalse(items[0].overridden)
        detail = self.client.get(reverse("plan_detail", args=[self.plan.pk]))
        self.assertContains(detail, self.exercises[0].name)
        self.assertContains(detail, self.exercises[2].name)
        self.assertNotContains(detail, self.exercises[1].name)
        choices = self.client.get(reverse("plan_add", args=[self.plan.pk])).context["form"].fields["recommendations"].queryset
        self.assertEqual(list(choices.values_list("exercise_id", flat=True)), [self.exercises[1].pk])

    def test_exercise_recommendation_from_other_phase_is_rejected(self):
        foreign = Recommendation.objects.create(phase=self.empty_phase, exercise=self.exercises[0])
        response = self.select(foreign)
        self.assertEqual(response.status_code, 200)
        self.assertIn("recommendations", response.context["form"].errors)
        self.assertEqual(self.plan.items.count(), 0)

    def test_move_and_delete_are_post_only_and_persist_order(self):
        self.select(*self.recommendations)
        first, second, third = list(self.plan.items.all())
        move = reverse("plan_item_move", args=[third.pk, "up"])
        self.assertEqual(self.client.get(move).status_code, 405)
        self.assertEqual(self.client.post(move).status_code, 302)
        self.assertEqual(list(self.plan.items.values_list("pk", flat=True)), [first.pk, third.pk, second.pk])
        remove = reverse("plan_item_delete", args=[third.pk])
        self.assertEqual(self.client.get(remove).status_code, 405)
        self.assertEqual(self.client.post(remove).status_code, 302)
        self.assertEqual(list(self.plan.items.values_list("pk", flat=True)), [first.pk, second.pk])

    def test_invalid_item_range_preserves_all_user_values(self):
        self.select(self.recommendations[0])
        item = self.plan.items.get()
        response = self.client.post(reverse("plan_item_edit", args=[item.pk]), {
            "sets_min": "5", "sets_max": "2", "reps_min": "9",
            "basis": "fixed", "fixed_weight": "22.5", "notes": "Moja notatka planu",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("sets_max", response.context["form"].errors)
        self.assertEqual(response.context["form"]["notes"].value(), "Moja notatka planu")
        self.assertEqual(response.context["form"]["reps_min"].value(), "9")
        item.refresh_from_db()
        self.assertEqual(item.sets_min, 2)
        self.assertFalse(item.overridden)

    def test_valid_item_edit_marks_override_without_changing_phase_recommendation(self):
        recommendation = self.recommendations[0]
        self.select(recommendation)
        item = self.plan.items.get()
        response = self.client.post(reverse("plan_item_edit", args=[item.pk]), {
            "sets_min": "4", "sets_max": "5", "reps_min": "6", "basis": "fixed",
            "fixed_weight": "25", "notes": "Własny wariant",
        })
        self.assertEqual(response.status_code, 302)
        item.refresh_from_db()
        recommendation.refresh_from_db()
        self.assertTrue(item.overridden)
        self.assertEqual(item.fixed_weight, Decimal("25"))
        self.assertEqual(recommendation.fixed_weight, Decimal("15"))

    def test_plan_can_be_reused_without_mutating_selected_items(self):
        self.select(self.recommendations[0])
        item = self.plan.items.get()
        start_url = reverse("plan_start", args=[self.plan.pk])
        payload = {"date": timezone.localdate().isoformat()}
        self.assertEqual(self.client.post(start_url, payload).status_code, 302)
        self.assertEqual(self.client.post(start_url, payload).status_code, 302)
        sessions = list(Workout.objects.filter(plan=self.plan))
        self.assertEqual(len(sessions), 2)
        self.assertNotEqual(sessions[0].pk, sessions[1].pk)
        self.assertEqual(self.plan.items.get().pk, item.pk)
        self.assertEqual([s.exercises.count() for s in sessions], [1, 1])

    def test_empty_phase_reports_missing_data_and_empty_plan_cannot_start(self):
        empty = Plan.objects.create(profile=self.profile, phase=self.empty_phase, name="Program do uzupełnienia")
        response = self.client.get(reverse("plan_add", args=[empty.pk]))
        self.assertContains(response, "Brak danych")
        self.assertEqual(response.context["form"].fields["recommendations"].queryset.count(), 0)
        response = self.client.post(reverse("plan_start", args=[empty.pk]), {"date": timezone.localdate().isoformat()})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["start_form"].non_field_errors())
        self.assertEqual(Workout.objects.filter(plan=empty).count(), 0)

    def test_settings_normalizes_decimal_selected_option_and_stores_step(self):
        response = self.client.get(reverse("settings"))
        self.assertEqual(response.context["form"]["rounding_step"].value(), "2.5")
        self.assertContains(response, 'value="2.5" selected')
        self.assertEqual(self.client.post(reverse("settings"), {"rounding_step": "0.5"}).status_code, 302)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.rounding_step, Decimal("0.5"))

    def test_plan_and_workout_access_are_scoped_to_active_profile(self):
        self.select(self.recommendations[0])
        self.client.post(reverse("plan_start", args=[self.plan.pk]), {"date": timezone.localdate().isoformat()})
        workout = Workout.objects.get(plan=self.plan)
        item = self.plan.items.get()
        self.client.post(reverse("profile_switch", args=[self.other.pk]))
        for name, args in (
            ("plan_detail", [self.plan.pk]), ("plan_edit", [self.plan.pk]),
            ("plan_add", [self.plan.pk]), ("plan_item_edit", [item.pk]),
            ("workout", [workout.pk]),
        ):
            with self.subTest(route=name):
                self.assertEqual(self.client.get(reverse(name, args=args)).status_code, 404)
        response = self.client.get(reverse("history"))
        self.assertNotContains(response, self.plan.name)
