import json
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from training.models import Profile


class LocalExportTests(TestCase):
    def test_export_all_and_single_profile_without_changing_source(self):
        first = Profile.objects.create(name='Pierwszy')
        Profile.objects.create(name='Drugi')
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'copy.json'
            call_command('export_local_backup', output=str(output), verbosity=0)
            data = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(data['schema_version'], 2)
            self.assertEqual(len(data['profile']), 2)
            self.assertTrue(all('owner' not in row['fields'] for row in data['profile']))
            call_command('export_local_backup', profile=first.pk,
                         output=str(Path(folder) / 'one.json'), verbosity=0)
            self.assertEqual(Profile.objects.count(), 2)
            self.assertEqual(len(json.loads((Path(folder) / 'one.json').read_text())['profile']), 1)

    def test_refuses_overwrite(self):
        Profile.objects.create(name='Profil')
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'copy.json'
            output.write_text('original', encoding='utf-8')
            with self.assertRaises(CommandError):
                call_command('export_local_backup', output=str(output))
            self.assertEqual(output.read_text(), 'original')

    def test_refuses_public_directory(self):
        Profile.objects.create(name='Profil')
        with self.assertRaises(CommandError):
            call_command('export_local_backup', output=str(Path(settings.BASE_DIR) / 'web' / 'private.json'))
