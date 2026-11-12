from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from training.models import Profile

class Command(BaseCommand):
    help = 'Przypisuje wyłącznie nieprzypisany profil do istniejącego konta; zachowuje historię.'
    def add_arguments(self, parser):
        parser.add_argument('--profile', type=int, required=True)
        parser.add_argument('--username', required=True)
    @transaction.atomic
    def handle(self, *args, **options):
        try:
            user = get_user_model().objects.get(username=options['username'])
            profile = Profile.objects.select_for_update().get(pk=options['profile'])
        except (get_user_model().DoesNotExist, Profile.DoesNotExist):
            raise CommandError('Nie znaleziono konta lub profilu.')
        if profile.owner_id and profile.owner_id != user.pk:
            raise CommandError('Profil ma już innego właściciela. Użyj świadomej edycji w panelu administratora.')
        profile.owner = user
        profile.save(update_fields=['owner'])
        self.stdout.write(self.style.SUCCESS('Przypisano profil; historia pozostała bez zmian.'))
