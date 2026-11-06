from decimal import Decimal
from django import forms
from django.utils import timezone
from .models import BodyWeight, OneRepMax, Plan, PlanItem, Profile, Recommendation


class ProfileForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ['name', 'notes']
        labels = {'name': 'Imię / nazwa profilu', 'notes': 'Uwagi'}
        widgets = {'notes': forms.Textarea(attrs={'rows': 3})}


class BodyWeightForm(forms.ModelForm):
    class Meta:
        model = BodyWeight
        fields = ['date', 'value']
        labels = {'date': 'Data pomiaru', 'value': 'Masa ciała (kg)'}
        widgets = {'date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
                   'value': forms.NumberInput(attrs={'min': '0.01', 'step': '0.01', 'inputmode': 'decimal'})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['date'].initial = timezone.localdate()


    def clean(self):
        data = super().clean()
        day = data.get('date')
        profile_id = self.instance.profile_id
        if day and profile_id and BodyWeight.objects.filter(profile_id=profile_id, date=day).exclude(pk=self.instance.pk).exists():
            self.add_error('date', 'Dla tego dnia zapisano już pomiar masy ciała. Wybierz inną datę.')
        return data


class OneRepMaxForm(forms.ModelForm):
    class Meta:
        model = OneRepMax
        fields = ['date', 'value']
        labels = {'date': 'Data pomiaru', 'value': 'Ręcznie ustalone 1RM (kg)'}
        widgets = {'date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
                   'value': forms.NumberInput(attrs={'min': '0.01', 'step': '0.01', 'inputmode': 'decimal'})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['date'].initial = timezone.localdate()


class PlanForm(forms.ModelForm):
    class Meta:
        model = Plan
        fields = ['name', 'phase']
        labels = {'name': 'Nazwa planu', 'phase': 'Faza treningu'}


PRESCRIPTION_FIELDS = ['sets_min', 'sets_max', 'reps_min', 'reps_max', 'seconds',
                       'percent_min', 'percent_max', 'basis', 'fixed_weight',
                       'tempo', 'rest_seconds', 'notes']


class PlanItemForm(forms.ModelForm):
    class Meta:
        model = PlanItem
        fields = PRESCRIPTION_FIELDS
        labels = {'sets_min': 'Serie od', 'sets_max': 'Serie do (opcjonalnie)',
                  'reps_min': 'Powtórzenia od', 'reps_max': 'Powtórzenia do (opcjonalnie)',
                  'seconds': 'Czas ćwiczenia (s)', 'percent_min': 'Obciążenie od (%)',
                  'percent_max': 'Obciążenie do (%)', 'basis': 'Podstawa obciążenia',
                  'fixed_weight': 'Stały ciężar (kg)', 'tempo': 'Tempo',
                  'rest_seconds': 'Odpoczynek (s)', 'notes': 'Uwagi do planu'}
        widgets = {'notes': forms.Textarea(attrs={'rows': 3})}


class RecommendationChoiceField(forms.ModelMultipleChoiceField):
    def label_from_instance(self, obj):
        def span(a, b):
            return 'Brak danych' if a is None else str(a) + (f'–{b}' if b is not None and b != a else '')
        target = f'{obj.seconds} s' if obj.exercise.mode == 'time' and obj.seconds else span(obj.reps_min, obj.reps_max) + ' powt.'
        load = obj.get_basis_display() or 'Brak danych o obciążeniu'
        if obj.basis in ('rm', 'body'):
            load = span(obj.percent_min, obj.percent_max) + '% · ' + load
        elif obj.basis == 'fixed':
            load += ': ' + (str(obj.fixed_weight) + ' kg' if obj.fixed_weight is not None else 'Brak danych')
        tempo = obj.tempo or 'Brak danych'
        rest = f'{obj.rest_seconds} s' if obj.rest_seconds is not None else 'Brak danych'
        return f'{obj.exercise.name} · {span(obj.sets_min, obj.sets_max)} serii · {target} · {load} · tempo: {tempo} · odpoczynek: {rest}' + (f' · {obj.notes}' if obj.notes else '')


class AddExercisesForm(forms.Form):
    recommendations = RecommendationChoiceField(queryset=Recommendation.objects.none(),
        widget=forms.CheckboxSelectMultiple, label='Ćwiczenia przypisane do fazy', required=True)

    def __init__(self, *args, plan, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['recommendations'].queryset = Recommendation.objects.filter(
            phase=plan.phase).exclude(exercise_id__in=plan.items.values_list('exercise_id', flat=True)).select_related('exercise')


class StartWorkoutForm(forms.Form):
    date = forms.DateField(label='Dzień treningu', initial=timezone.localdate,
                          widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'))


class SettingsForm(forms.ModelForm):
    rounding_step = forms.TypedChoiceField(label='Krok zaokrąglania ciężaru (kg)', coerce=Decimal,
        choices=[('0.5', '0,5 kg'), ('1', '1 kg'), ('2.5', '2,5 kg'), ('5', '5 kg')])

    class Meta:
        model = Profile
        fields = ['rounding_step']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        value = self.instance.rounding_step if self.instance and self.instance.pk else Decimal('2.5')
        self.initial['rounding_step'] = format(Decimal(value).normalize(), 'f')
