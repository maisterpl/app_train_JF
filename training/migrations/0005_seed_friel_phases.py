from django.db import migrations


def load_user_material(apps, schema_editor):
    from training.friel_data import seed_friel
    seed_friel(apps=apps, using=schema_editor.connection.alias)


class Migration(migrations.Migration):
    dependencies = [('training', '0004_strengthgoal_onerepmax_is_estimated_and_more')]

    operations = [migrations.RunPython(load_user_material, migrations.RunPython.noop)]
