import uuid
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


POSITIVE = MinValueValidator(Decimal('0.01'))
NONNEGATIVE = MinValueValidator(0)


class Profile(models.Model):
    name = models.CharField('Imię / nazwa', max_length=100)
    notes = models.TextField('Uwagi', blank=True)
    rounding_step = models.DecimalField('Krok zaokrąglania (kg)', max_digits=5, decimal_places=2, default=Decimal('2.5'), validators=[POSITIVE])

    class Meta:
        ordering = ['name', 'pk']
        constraints = [models.CheckConstraint(condition=Q(rounding_step__gt=0), name='profile_step_positive')]

    def __str__(self):
        return self.name


class BodyWeight(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name='body_weights')
    date = models.DateField('Data', default=timezone.localdate)
    value = models.DecimalField('Masa ciała (kg)', max_digits=7, decimal_places=2, validators=[POSITIVE])

    class Meta:
        ordering = ['-date', '-pk']
        constraints = [models.UniqueConstraint(fields=['profile', 'date'], name='body_weight_profile_date'), models.CheckConstraint(condition=Q(value__gt=0), name='body_weight_positive')]

    def __str__(self):
        return f'{self.profile}: {self.value} kg ({self.date})'


class Exercise(models.Model):
    MODES = [('reps', 'Powtórzenia'), ('time', 'Czas')]
    name = models.CharField('Nazwa', max_length=160, unique=True)
    description = models.TextField('Wykonanie i technika', blank=True)
    category = models.CharField('Kategoria', max_length=100, blank=True)
    mode = models.CharField('Sposób rejestrowania', max_length=8, choices=MODES, default='reps')
    load_notation = models.CharField('Sposób zapisu ciężaru', max_length=200, default='Łączny ciężar zewnętrzny w kg')

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class OneRepMax(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name='one_rep_maxes')
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name='one_rep_maxes')
    date = models.DateField('Data', default=timezone.localdate)
    value = models.DecimalField('1RM (kg)', max_digits=8, decimal_places=2, validators=[POSITIVE])

    class Meta:
        ordering = ['-date', '-pk']
        constraints = [models.CheckConstraint(condition=Q(value__gt=0), name='one_rm_positive')]

    def __str__(self):
        return f'{self.profile}, {self.exercise}: {self.value} kg'


class Phase(models.Model):
    name = models.CharField('Nazwa fazy', max_length=160, unique=True)
    description = models.TextField('Opis', blank=True)
    is_demo = models.BooleanField('Dane DEMO', default=False)
    source = models.TextField('Źródło i wydanie / strona', blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Prescription(models.Model):
    BASES = [('rm', '% 1RM'), ('body', '% masy ciała'), ('fixed', 'Stały ciężar'), ('none', 'Brak obciążenia')]
    sets_min = models.PositiveIntegerField('Serie od', null=True, blank=True, validators=[MinValueValidator(1)])
    sets_max = models.PositiveIntegerField('Serie do', null=True, blank=True, validators=[MinValueValidator(1)])
    reps_min = models.PositiveIntegerField('Powtórzenia od', null=True, blank=True, validators=[MinValueValidator(1)])
    reps_max = models.PositiveIntegerField('Powtórzenia do', null=True, blank=True, validators=[MinValueValidator(1)])
    seconds = models.PositiveIntegerField('Czas (s)', null=True, blank=True, validators=[MinValueValidator(1)])
    percent_min = models.DecimalField('Procent od', max_digits=7, decimal_places=2, null=True, blank=True, validators=[NONNEGATIVE])
    percent_max = models.DecimalField('Procent do', max_digits=7, decimal_places=2, null=True, blank=True, validators=[NONNEGATIVE])
    basis = models.CharField('Podstawa obliczeń', max_length=8, choices=BASES, blank=True, default='')
    fixed_weight = models.DecimalField('Stały ciężar (kg)', max_digits=8, decimal_places=2, null=True, blank=True, validators=[NONNEGATIVE])
    tempo = models.CharField('Tempo', max_length=80, blank=True)
    rest_seconds = models.PositiveIntegerField('Odpoczynek (s)', null=True, blank=True)
    notes = models.TextField('Uwagi', blank=True)

    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        errors = {}
        for lower, upper in [('sets_min', 'sets_max'), ('reps_min', 'reps_max'), ('percent_min', 'percent_max')]:
            low, high = getattr(self, lower), getattr(self, upper)
            if low is not None and high is not None and high < low:
                errors[upper] = 'Górna granica nie może być mniejsza od dolnej.'
        if errors:
            raise ValidationError(errors)


class Recommendation(Prescription):
    phase = models.ForeignKey(Phase, on_delete=models.CASCADE, related_name='recommendations')
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name='recommendations')

    class Meta:
        ordering = ['pk']
        constraints = [models.UniqueConstraint(fields=['phase', 'exercise'], name='recommendation_phase_exercise')]

    def __str__(self):
        return f'{self.phase}: {self.exercise}'


class Plan(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name='plans')
    name = models.CharField('Nazwa planu', max_length=160)
    phase = models.ForeignKey(Phase, on_delete=models.PROTECT, related_name='plans')

    class Meta:
        ordering = ['name', 'pk']

    def __str__(self):
        return self.name


class PlanItem(Prescription):
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name='items')
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name='plan_items')
    position = models.PositiveIntegerField('Kolejność', default=0)
    overridden = models.BooleanField('Ręczna zmiana zaleceń', default=False)

    class Meta:
        ordering = ['position', 'pk']

    def __str__(self):
        return f'{self.plan}: {self.position}. {self.exercise}'


class Workout(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name='workouts')
    plan = models.ForeignKey(Plan, on_delete=models.SET_NULL, null=True, blank=True, related_name='workouts')
    plan_name = models.CharField(max_length=160)
    phase_name = models.CharField(max_length=160)
    training_date = models.DateField('Dzień treningu', default=timezone.localdate)
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=[('active', 'W trakcie'), ('completed', 'Zakończony')], default='active')
    current_position = models.PositiveIntegerField(default=0)
    body_weight = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    body_weight_date = models.DateField(null=True, blank=True)
    rounding_step = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('2.5'))

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f'{self.plan_name} — {self.started_at:%Y-%m-%d}'


class WorkoutExercise(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name='exercises')
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name='workout_exercises')
    position = models.PositiveIntegerField(default=1)
    snapshot = models.JSONField(default=dict)
    skipped = models.BooleanField(default=False)

    class Meta:
        ordering = ['position', 'pk']
        constraints = [models.UniqueConstraint(fields=['workout', 'position'], name='workout_exercise_position')]

    def __str__(self):
        return self.snapshot.get('name', str(self.exercise))


class WorkoutSet(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workout_exercise = models.ForeignKey(WorkoutExercise, on_delete=models.CASCADE, related_name='sets')
    number = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    weight = models.DecimalField('Ciężar (kg)', max_digits=8, decimal_places=2, default=0, validators=[NONNEGATIVE])
    reps = models.PositiveIntegerField('Powtórzenia', null=True, blank=True)
    seconds = models.PositiveIntegerField('Czas (s)', null=True, blank=True)
    note = models.CharField('Notatka', max_length=500, blank=True)
    deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ['number', 'pk']
        constraints = [models.CheckConstraint(condition=Q(weight__gte=0), name='workout_set_weight_nonnegative')]


class SyncReceipt(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name='sync_receipts')
    created_at = models.DateTimeField(auto_now_add=True)
