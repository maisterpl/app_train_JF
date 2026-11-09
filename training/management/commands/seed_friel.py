from django.core.management.base import BaseCommand
from django.db import transaction

from training.friel_data import seed_friel


class Command(BaseCommand):
    help = 'Dodaje fazy AA, SM, WM, WS i US z materiałów użytkownika; zachowuje istniejące dane.'

    @transaction.atomic
    def handle(self, *args, **options):
        result = seed_friel()
        self.stdout.write(self.style.SUCCESS(
            f'Fazy z materiałów użytkownika: {result["phases"]}; '
            f'pozycje faz: {result["slots"]}; zakresy celów SM: {result["goals"]}. '
            'Brak pełnej tabeli 13.3 i przypisu AA ze strony 236 pozostaje oznaczony. '
            'Istniejące ustawienia oraz DEMO zostały zachowane.'
        ))
