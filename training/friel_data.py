"""Initial data transcribed from the user's material, not inferred book content.

``seed_friel(apps=historical_apps)`` is also used by a data migration. Keep this
module independent of current model imports so historical models remain usable.
Existing rows are preserved when the optional management command is repeated.
"""
from decimal import Decimal


SOURCE = (
    'Joe Friel, „Biblia treningu kolarza górskiego”, tabele 13.1–13.7; '
    'dane z materiałów dostarczonych przez użytkownika. '
    'Wymagają uzupełnienia: pełna tabela celów SM 13.3 oraz przypis AA ze strony 236.'
)
AA_LIMITATION = 'Brak przypisu do fazy AA ze strony 236. Jego treści nie odtworzono.'
SM_LIMITATION = (
    'Zakresy celów dotyczą 6 powtórzeń pod koniec fazy. Nie są ciężarem pierwszego '
    'treningu ani automatycznie wybranym celem osoby. Brak pełnej tabeli 13.3 '
    'i zasad doboru wartości w zakresie; brak mnożników wypychania nogami i stepu. '
    'Po osiągnięciu celu można zachować ciężar i zwiększać liczbę powtórzeń ponad 6.'
)
US_NOTE = (
    'Pierwsza seria: 60% 1RM; ostatnia: 80% 1RM. Przy trzech seriach ciężar '
    'drugiej nie został określony w dostępnym materiale. Ustala go użytkownik '
    'jako ustawienie własne; nie przyjęto automatycznie 70%.'
)
CORE_NOTE = (
    'Zachowano parametry AA, w tym zapis 40–60% 1RM. Brak danych o sposobie '
    'określania obciążenia tego ćwiczenia tułowia. Nie podstawiaj masy ciała '
    'jako 1RM; ustal obciążenie ręcznie.'
)


PHASES = {
    'AA': {
        'name': 'AA — adaptacja anatomiczna',
        'description': (
            'Etap nauki i utrwalania techniki oraz stopniowego przyzwyczajania '
            'organizmu do treningu siłowego i późniejszych większych obciążeń. '
            'To krótkie objaśnienie dla użytkownika, nie cytat z książki. ' + AA_LIMITATION
        ),
        'sessions_min': 8, 'sessions_max': 12,
        'weekly_min': 2, 'weekly_max': 3,
    },
    'SM': {
        'name': 'SM — siła maksymalna',
        'description': (
            'Rozwijanie zdolności do pokonywania większego oporu. Obciążenie '
            'zwiększa się stopniowo, a cele względem masy ciała dotyczą końca '
            'fazy. To krótkie objaśnienie dla użytkownika, nie cytat z książki. '
            + SM_LIMITATION
        ),
        'sessions_min': 8, 'sessions_max': 12,
        'weekly_min': 2, 'weekly_max': 3,
    },
    'WM': {
        'name': 'WM — wytrzymałość mocy',
        'description': (
            'Rozwijanie zdolności do wielokrotnego wykonywania dynamicznych '
            'ruchów. Wyróżnikiem jest szybkie podnoszenie przy mniejszym '
            'obciążeniu niż w treningu siły maksymalnej. To krótkie objaśnienie '
            'dla użytkownika, nie cytat z książki.'
        ),
        'sessions_min': 6, 'sessions_max': 8,
        'weekly_min': 1, 'weekly_max': 2,
    },
    'WS': {
        'name': 'WS — wytrzymałość siłowa',
        'description': (
            'Rozwijanie zdolności do powtarzania pracy siłowej przy narastającym '
            'zmęczeniu. Wyróżnia ją duża liczba powtórzeń. To krótkie objaśnienie '
            'dla użytkownika, nie cytat z książki.'
        ),
        'sessions_min': 4, 'sessions_max': 8,
        'weekly_min': 1, 'weekly_max': 1,
    },
    'US': {
        'name': 'US — utrzymanie siły',
        'description': (
            'Podtrzymanie wcześniej zbudowanej siły przy ograniczonej '
            'częstotliwości treningów. Liczba sesji w fazie nie ma określonego '
            'limitu. To krótkie objaśnienie dla użytkownika, nie cytat z książki.'
        ),
        'sessions_min': None, 'sessions_max': None, 'sessions_unlimited': True,
        'weekly_min': 1, 'weekly_max': 1,
    },
}

PARAMETERS = {
    'AA': dict(sets_min=2, sets_max=5, reps_min=20, reps_max=30,
               reps_original='20–30', percent_min=Decimal('40'),
               percent_max=Decimal('60'), basis='rm', tempo='powoli',
               rest_seconds=60, rest_seconds_max=90),
    'SM': dict(sets_min=2, sets_max=6, reps_min=3, reps_max=6,
               reps_original='3–6+', percent_min=None, percent_max=None,
               basis='', tempo='powoli do średnio', rest_seconds=120,
               rest_seconds_max=240, notes=SM_LIMITATION),
    'WM': dict(sets_min=2, sets_max=3, reps_min=8, reps_max=15,
               reps_original='8–15+', percent_min=Decimal('40'),
               percent_max=Decimal('60'), basis='rm', tempo='szybko',
               rest_seconds=180, rest_seconds_max=300,
               notes='Znak „+” zachowano ze źródła. Nie oznacza automatycznie treningu do upadku.'),
    'WS': dict(sets_min=1, sets_max=3, reps_min=40, reps_max=60,
               reps_original='40–60', percent_min=Decimal('30'),
               percent_max=Decimal('50'), basis='rm', tempo='średnio',
               rest_seconds=60, rest_seconds_max=120),
    'US': dict(sets_min=2, sets_max=3, reps_min=6, reps_max=12,
               reps_original='6–12', percent_min=None, percent_max=None,
               basis='rm', tempo='średnio', rest_seconds=60,
               rest_seconds_max=120, series_load_mode='endpoints', notes=US_NOTE),
}

HIP = ('Przysiad', 'Wypychanie nogami', 'Step')
SHOULDER = ('Wyciskanie na ławce', 'Ściąganie do klatki piersiowej na siedząco')
WEAKNESS = ('Uginanie nóg leżąc', 'Prostowanie nóg w siadzie', 'Wspięcia na palce')
SEATED_ROW = 'Wiosłowanie na siedząco'
STANDING_ROW = 'Wiosłowanie na stojąco'
CORE = 'Skłony ze skrętem'


def _slots(code):
    if code == 'AA':
        return [
            ('Wyprost biodra', 'hip', HIP[0], HIP, 'AA'),
            (SHOULDER[1], 'fixed', SHOULDER[1], (SHOULDER[1],), 'AA'),
            ('Drugi wyprost biodra — inny wariant', 'hip', HIP[1], HIP, 'AA'),
            (SHOULDER[0], 'fixed', SHOULDER[0], (SHOULDER[0],), 'AA'),
            (SEATED_ROW, 'fixed', SEATED_ROW, (SEATED_ROW,), 'AA'),
            ('Osobiste słabości', 'weakness', WEAKNESS[0], WEAKNESS, 'AA'),
            (STANDING_ROW, 'fixed', STANDING_ROW, (STANDING_ROW,), 'AA'),
            (CORE, 'fixed', CORE, (CORE,), 'AA'),
        ]
    return [
        ('Wyprost biodra', 'hip', HIP[0], HIP, code),
        (SEATED_ROW, 'fixed', SEATED_ROW, (SEATED_ROW,), code),
        (CORE, 'fixed', CORE, (CORE,), 'AA'),
        ('Ćwiczenie obręczy barkowej', 'shoulder', SHOULDER[0], SHOULDER, 'AA'),
        ('Osobiste słabości', 'weakness', WEAKNESS[0], WEAKNESS, 'AA'),
        (STANDING_ROW, 'fixed', STANDING_ROW, (STANDING_ROW,), code),
    ]


def seed_friel(apps=None, using='default'):
    """Add the supplied program without overwriting existing user changes."""
    if apps is None:
        from django.apps import apps
    Phase = apps.get_model('training', 'Phase')
    PhaseSlot = apps.get_model('training', 'PhaseSlot')
    Exercise = apps.get_model('training', 'Exercise')
    StrengthGoal = apps.get_model('training', 'StrengthGoal')
    Plan = apps.get_model('training', 'Plan')
    Recommendation = apps.get_model('training', 'Recommendation')

    exercises = {}
    names = (*HIP, *SHOULDER, *WEAKNESS, SEATED_ROW, STANDING_ROW, CORE)
    for name in names:
        category = ('Wyprost biodra' if name in HIP else
                    'Obręcz barkowa' if name in SHOULDER else
                    'Ćwiczenia pomocnicze' if name in WEAKNESS else
                    'Tułów' if name == CORE else 'Wiosłowanie')
        exercises[name], _ = Exercise.objects.using(using).get_or_create(
            name=name,
            defaults={
                'category': category,
                'mode': 'reps',
                'description': 'Brak szczegółowych danych technicznych w dostarczonym materiale.',
                'load_notation': ('Brak danych o sposobie określania obciążenia ćwiczenia tułowia.'
                                  if name == CORE else
                                  'Ciężar zewnętrzny w kg; pomiar 1RM musi używać tej samej konwencji zapisu.'),
            },
        )

    phases = {}
    for code, fields in PHASES.items():
        phases[code], _ = Phase.objects.using(using).get_or_create(
            code=code,
            defaults={'is_demo': False, 'source': SOURCE, **fields},
        )
        for position, (title, category, default, allowed, parameters) in enumerate(_slots(code), 1):
            prescription = dict(PARAMETERS[parameters], parameter_code=parameters)
            if parameters == 'AA':
                prescription['notes'] = AA_LIMITATION
            if default == CORE:
                prescription['basis'] = ''
                prescription['notes'] = f'{prescription.get("notes", "")} {CORE_NOTE}'.strip()
            if code == 'AA' and category == 'hip':
                prescription['notes'] = (
                    f'{prescription.get("notes", "")} Pozycje 1 i 3 wymagają '
                    'różnych wariantów wyprostu biodra.'
                ).strip()
            slot, created = PhaseSlot.objects.using(using).get_or_create(
                phase=phases[code], position=position,
                defaults={
                    'title': title, 'category': category,
                    'default_exercise': exercises[default], **prescription,
                },
            )
            if created:
                slot.allowed_exercises.add(*(exercises[name] for name in allowed))

    for name, lower, upper in [
        ('Przysiad', '1.3', '1.7'),
        (SEATED_ROW, '0.5', '0.8'),
        (STANDING_ROW, '0.4', '0.7'),
    ]:
        StrengthGoal.objects.using(using).get_or_create(
            phase=phases['SM'], exercise=exercises[name],
            defaults={
                'multiplier_min': Decimal(lower), 'multiplier_max': Decimal(upper),
                'target_reps': 6,
                'source': SOURCE,
                'notes': SM_LIMITATION,
            },
        )

    # This was an empty onboarding placeholder, not a training phase. Preserve it
    # when somebody has already used or extended it.
    for placeholder in Phase.objects.using(using).filter(name='Joe Friel — Brak danych'):
        if (not Plan.objects.using(using).filter(phase=placeholder).exists()
                and not Recommendation.objects.using(using).filter(phase=placeholder).exists()
                and not PhaseSlot.objects.using(using).filter(phase=placeholder).exists()
                and not StrengthGoal.objects.using(using).filter(phase=placeholder).exists()):
            placeholder.delete(using=using)
    return {
        'phases': len(phases),
        'slots': sum(len(_slots(code)) for code in PHASES),
        'goals': 3,
    }
