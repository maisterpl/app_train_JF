from pathlib import Path
import sqlite3
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

class Command(BaseCommand):
    help = 'Spójna kopia SQLite przez backup API; pobierz plik poza serwer.'
    def add_arguments(self, parser):
        parser.add_argument('destination')
    def handle(self, *args, **options):
        source=Path(settings.DATABASES['default']['NAME']).resolve()
        destination=Path(options['destination']).resolve()
        if not source.is_file():
            raise CommandError('Nie znaleziono pliku źródłowej bazy SQLite.')
        if destination.exists() or source == destination:
            raise CommandError('Wybierz nową ścieżkę; istniejący plik nie zostanie nadpisany.')
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db, sqlite3.connect(destination) as backup:
            db.backup(backup)
        destination.chmod(0o600)
        self.stdout.write(self.style.SUCCESS('Utworzono kopię bazy. Przechowuj ją bezpiecznie poza serwerem.'))
