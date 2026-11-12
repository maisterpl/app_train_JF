"""One-time, read-only migration of an existing SQLite installation to local PWA."""
import json
import os
from pathlib import Path

from django.core import serializers
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from training.models import (BodyWeight, Exercise, OneRepMax, Phase, PhaseSlot, Plan,
                             PlanItem, Profile, Recommendation, StrengthGoal, Workout,
                             WorkoutExercise, WorkoutSet)


class Command(BaseCommand):
    help = 'Eksportuje istniejące profile do JSON importowanego przez lokalną PWA. Nie zmienia bazy.'

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help='Nowy plik JSON poza katalogiem web/.')
        parser.add_argument('--profile', type=int, help='Opcjonalnie identyfikator jednego profilu; domyślnie wszystkie.')

    @transaction.atomic
    def handle(self, *args, **options):
        target = Path(options['output']).resolve()
        web = Path(__file__).resolve().parents[3] / 'web'
        if target == web or web in target.parents:
            raise CommandError('Zapisz prywatną kopię poza publicznym katalogiem web/.')
        profiles = Profile.objects.all()
        if options['profile'] is not None:
            profiles = profiles.filter(pk=options['profile'])
        if not profiles.exists():
            raise CommandError('Nie znaleziono profili do eksportu.')

        def rows(query, fields=None):
            return json.loads(serializers.serialize('json', query, fields=fields))

        data = dict(schema_version=2, exported_at=timezone.now().isoformat(),
                    profile=rows(profiles, ('name', 'notes', 'rounding_step')),
                    body_weights=rows(BodyWeight.objects.filter(profile__in=profiles)),
                    one_rep_max=rows(OneRepMax.objects.filter(profile__in=profiles)),
                    exercises=rows(Exercise.objects.all()), phases=rows(Phase.objects.all()),
                    phase_slots=rows(PhaseSlot.objects.all()), strength_goals=rows(StrengthGoal.objects.all()),
                    recommendations=rows(Recommendation.objects.all()),
                    plans=rows(Plan.objects.filter(profile__in=profiles)),
                    plan_items=rows(PlanItem.objects.filter(plan__profile__in=profiles)),
                    workouts=rows(Workout.objects.filter(profile__in=profiles)),
                    workout_exercises=rows(WorkoutExercise.objects.filter(workout__profile__in=profiles)),
                    sets=rows(WorkoutSet.objects.filter(workout_exercise__workout__profile__in=profiles)))
        try:
            # O_EXCL refuses an overwrite; permission mode keeps the backup private.
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
        except OSError as error:
            raise CommandError(f'Nie można utworzyć nowej kopii: {error}') from error
        self.stdout.write(self.style.SUCCESS('Zapisano kopię JSON. Zaimportuj ją w Ustawieniach lokalnej PWA. Baza źródłowa pozostaje bez zmian.'))
