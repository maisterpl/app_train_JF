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
                       'tempo', 'rest_seconds', 'notes', 'parameter_code',
                       'reps_original', 'rest_seconds_max', 'series_load_mode',
                       'chosen_sets', 'middle_weight']

EDITABLE_PRESCRIPTION_FIELDS = [name for name in PRESCRIPTION_FIELDS
                               if name not in ('parameter_code', 'reps_original')]


class PlanItemForm(forms.ModelForm):
    exercise = forms.ModelChoiceField(queryset=None, label='Wariant ćwiczenia', required=False)

    class Meta:
        model = PlanItem
        fields = ['exercise'] + EDITABLE_PRESCRIPTION_FIELDS
        labels = {'sets_min': 'Serie od', 'sets_max': 'Serie do (opcjonalnie)',
                  'reps_min': 'Powtórzenia od', 'reps_max': 'Powtórzenia do (opcjonalnie)',
                  'seconds': 'Czas ćwiczenia (s)', 'percent_min': 'Obciążenie od (%)',
                  'percent_max': 'Obciążenie do (%)', 'basis': 'Podstawa obciążenia',
                  'fixed_weight': 'Stały ciężar (kg)', 'tempo': 'Tempo',
                  'rest_seconds': 'Odpoczynek od (s)', 'rest_seconds_max': 'Odpoczynek do (s)',
                  'series_load_mode': 'Sposób ustalenia obciążenia serii',
                  'chosen_sets': 'Wybrana liczba serii (US: 2 albo 3)',
                  'middle_weight': 'Własny ciężar środkowej serii US (kg)',
                  'notes': 'Uwagi do planu'}
        widgets = {'notes': forms.Textarea(attrs={'rows': 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from .models import Exercise
        item = self.instance
        self.fields['exercise'].queryset = (item.slot.allowed_exercises.all()
            if item.slot_id else Exercise.objects.filter(pk=item.exercise_id))
        self.fields['exercise'].initial = item.exercise_id
        self.fields['series_load_mode'].required = False
        self.fields['exercise'].help_text = 'Dla wybranego wariantu aplikacja użyje jego własnego 1RM.'
        self.fields['middle_weight'].help_text = 'Ustawienie własne. Materiał nie określa ciężaru drugiej serii przy trzech seriach; nie przyjmujemy automatycznie 70%.'
        self.fields['chosen_sets'].help_text = 'Dla obciążenia pierwsza/ostatnia seria wybierz 2 lub 3. Pozostaw puste dla zwykłego zakresu serii.'

    def clean_exercise(self):
        return self.cleaned_data.get('exercise') or self.instance.exercise

    def clean_series_load_mode(self):
        return self.cleaned_data.get('series_load_mode') or self.instance.series_load_mode or 'uniform'

    def clean(self):
        data = super().clean()
        item = self.instance
        exercise = data.get('exercise')
        if (item.slot_id and item.slot.category == 'hip' and item.plan.phase.code == 'AA'
                and exercise and item.plan.items.exclude(pk=item.pk).filter(
                    slot__category='hip', exercise=exercise).exists()):
            self.add_error('exercise', 'Pozycje wyprostu biodra w AA muszą mieć różne warianty ćwiczenia.')
        if data.get('series_load_mode') == 'endpoints' and data.get('chosen_sets') not in (2, 3):
            self.add_error('chosen_sets', 'Dla US wybierz 2 albo 3 serie.')
        return data


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


class AddPhaseSlotsForm(forms.Form):
    """A position is selected separately from its exercise variant."""

    def __init__(self, *args, plan, preselect=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.plan = plan
        self.slots = list(plan.phase.slots.exclude(
            pk__in=plan.items.exclude(slot=None).values_list('slot_id', flat=True)
        ).select_related('default_exercise').prefetch_related('allowed_exercises').order_by('position', 'pk'))
        for slot in self.slots:
            self.fields[f'select_{slot.pk}'] = forms.BooleanField(
                required=False, label=slot.title, initial=preselect)
            self.fields[f'exercise_{slot.pk}'] = forms.ModelChoiceField(
                queryset=slot.allowed_exercises.all(), required=False,
                label='Wariant ćwiczenia', initial=slot.default_exercise_id)
            if slot.series_load_mode == 'endpoints':
                self.fields[f'sets_{slot.pk}'] = forms.TypedChoiceField(
                    label='Liczba serii w tym planie', coerce=int,
                    choices=[(2, '2 serie: 60%, 80% 1RM'),
                             (3, '3 serie: 60%, własna środkowa, 80% 1RM')],
                    required=False, initial=2)

    def clean(self):
        data = super().clean()
        choices = []
        hips = set(self.plan.items.filter(slot__category='hip').values_list('exercise_id', flat=True))
        for slot in self.slots:
            if not data.get(f'select_{slot.pk}'):
                continue
            exercise = data.get(f'exercise_{slot.pk}')
            if exercise is None:
                self.add_error(f'exercise_{slot.pk}', 'Wybierz wariant dla zaznaczonej pozycji.')
                continue
            if self.plan.phase.code == 'AA' and slot.category == 'hip':
                if exercise.pk in hips:
                    self.add_error(f'exercise_{slot.pk}', 'Pozycje 1 i 3 w AA muszą mieć różne ćwiczenia wyprostu biodra.')
                hips.add(exercise.pk)
            count = data.get(f'sets_{slot.pk}')
            if slot.series_load_mode == 'endpoints' and count not in (2, 3):
                self.add_error(f'sets_{slot.pk}', 'Wybierz 2 albo 3 serie.')
            choices.append((slot, exercise, count))
        if not choices:
            raise forms.ValidationError('Zaznacz co najmniej jedną pozycję planu.')
        data['selections'] = choices
        return data

    def slot_rows(self):
        return [{'slot': slot, 'selected': self[f'select_{slot.pk}'],
                 'exercise': self[f'exercise_{slot.pk}'],
                 'chosen_sets': self[f'sets_{slot.pk}'] if f'sets_{slot.pk}' in self.fields else None}
                for slot in self.slots]


class EstimateRMForm(forms.Form):
    weight = forms.DecimalField(label='Ciężar wykonanej próby (kg)', min_value=Decimal('0.01'),
        max_digits=8, decimal_places=2,
        widget=forms.NumberInput(attrs={'min': '0.01', 'step': '0.01', 'inputmode': 'decimal'}))
    reps = forms.TypedChoiceField(label='Powtórzenia wykonane do granicy możliwości', coerce=int,
        choices=[(n, str(n)) for n in range(4, 11)])
    date = forms.DateField(label='Data próby', initial=timezone.localdate,
        widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'))
    at_limit = forms.BooleanField(label='Potwierdzam, że próba była wykonana do granicy możliwości.')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            field.widget.attrs['id'] = f'estimate-{name}'


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
