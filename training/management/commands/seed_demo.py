from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from training.models import (
    BodyWeight,
    Exercise,
    OneRepMax,
    Phase,
    Plan,
    PlanItem,
    Profile,
    Recommendation,
)


class Command(BaseCommand):
    help = "Dodaje wyraźnie oznaczone dane DEMO. Nie są to zalecenia Joe Friela."

    @transaction.atomic
    def handle(self, *args, **options):
        today = timezone.localdate()
        profile, _ = Profile.objects.get_or_create(
            name="Kolarz DEMO",
            defaults={
                "notes": "Profil demonstracyjny. Wszystkie liczby są przykładowe.",
                "rounding_step": Decimal("2.5"),
            },
        )
        if not BodyWeight.objects.filter(profile=profile).exists():
            BodyWeight.objects.create(profile=profile, date=today, value=Decimal("80"))
        phase, _ = Phase.objects.get_or_create(
            name="DEMO — przygotowanie ogólne",
            defaults={
                "description": (
                    "Zestaw wyłącznie do sprawdzenia funkcji aplikacji. "
                    "Parametry są przykładowe i nie pochodzą od Joe Friela."
                ),
                "is_demo": True,
                "source": "Dane demonstracyjne aplikacji; nie są programem Joe Friela.",
            },
        )
        if not Phase.objects.filter(code__in=['AA', 'SM', 'WM', 'WS', 'US']).exists():
            Phase.objects.get_or_create(
                name="Joe Friel — Brak danych",
                defaults={
                    "description": (
                        "Brak danych. Uzupełnij fazy i zalecenia wyłącznie na podstawie "
                        "dostarczonych materiałów lub zweryfikowanych danych projektu."
                    ),
                    "is_demo": False,
                    "source": "",
                },
            )
        definitions = (
            {
                "name": "DEMO — przysiad",
                "description": (
                    "Ruch demonstracyjny: stabilna pozycja, kontrolowany ruch i "
                    "zakres dostosowany do możliwości. Opis nie zastępuje instruktażu."
                ),
                "category": "DEMO / nogi",
                "mode": "reps",
                "load_notation": "Łączny ciężar zewnętrzny w kg",
                "prescription": {
                    "sets_min": 2, "sets_max": 3, "reps_min": 8, "reps_max": 10,
                    "percent_min": Decimal("50"), "percent_max": Decimal("60"),
                    "basis": "rm", "tempo": "Spokojne i kontrolowane (DEMO)",
                    "rest_seconds": 60,
                    "notes": "Przykładowe wartości DEMO, nie zalecenia Joe Friela.",
                },
            },
            {
                "name": "DEMO — wejście na stopień",
                "description": (
                    "Przykład ćwiczenia rejestrowanego powtórzeniami. "
                    "Stabilnie ustaw stopę na stopniu i kontroluj ruch."
                ),
                "category": "DEMO / nogi",
                "mode": "reps",
                "load_notation": "Łączny dodatkowy ciężar w kg; powtórzenia na stronę",
                "prescription": {
                    "sets_min": 2, "sets_max": 2, "reps_min": 8, "reps_max": 8,
                    "percent_min": Decimal("10"), "percent_max": Decimal("20"),
                    "basis": "body", "tempo": "Kontrolowane (DEMO)",
                    "rest_seconds": 60,
                    "notes": "DEMO: procent masy ciała określa dodatkowe obciążenie.",
                },
            },
            {
                "name": "DEMO — deska",
                "description": (
                    "Przykład ćwiczenia na czas. Zachowaj stabilną pozycję tułowia "
                    "i swobodny oddech; przerwij przy utracie kontroli pozycji."
                ),
                "category": "DEMO / tułów",
                "mode": "time",
                "load_notation": "Bez dodatkowego obciążenia",
                "prescription": {
                    "sets_min": 2, "sets_max": 2, "seconds": 30,
                    "basis": "none", "rest_seconds": 45,
                    "notes": "Przykład zapisu czasu; nie są to dane Joe Friela.",
                },
            },
        )
        plan, _ = Plan.objects.get_or_create(
            profile=profile,
            name="DEMO — trening kolarza",
            defaults={"phase": phase},
        )
        for position, definition in enumerate(definitions, start=1):
            fields = dict(definition)
            prescription = fields.pop("prescription")
            exercise, _ = Exercise.objects.get_or_create(
                name=fields.pop("name"), defaults=fields
            )
            Recommendation.objects.get_or_create(
                phase=phase, exercise=exercise, defaults=prescription
            )
            PlanItem.objects.get_or_create(
                plan=plan, exercise=exercise,
                defaults={"position": position, "overridden": False, **prescription},
            )
            if prescription["basis"] == "rm" and not OneRepMax.objects.filter(
                profile=profile, exercise=exercise
            ).exists():
                OneRepMax.objects.create(
                    profile=profile, exercise=exercise, date=today, value=Decimal("100")
                )
        self.stdout.write(self.style.SUCCESS(
            "Dane DEMO gotowe: profil, masa ciała, 1RM, trzy ćwiczenia i plan. "
            "To przykładowe dane aplikacji, NIE zalecenia Joe Friela. "
            "Fazy z materiałów użytkownika są oddzielnymi danymi."
        ))
