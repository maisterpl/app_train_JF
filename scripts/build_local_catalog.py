"""Build the public PWA catalogue from the project's verified Friel transcription.

No database, accounts or personal information is read by this command.
"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('friel', ROOT / 'training/friel_data.py')
friel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(friel)


def build():
    names = (*friel.HIP, *friel.SHOULDER, *friel.WEAKNESS,
             friel.SEATED_ROW, friel.STANDING_ROW, friel.CORE)
    exercises = []
    ids = {name: f'friel-ex-{i}' for i, name in enumerate(names, 1)}
    for name in names:
        category = ('Wyprost biodra' if name in friel.HIP else
                    'Obręcz barkowa' if name in friel.SHOULDER else
                    'Ćwiczenia pomocnicze' if name in friel.WEAKNESS else
                    'Tułów' if name == friel.CORE else 'Wiosłowanie')
        exercises.append(dict(id=ids[name], name=name, category=category, mode='reps',
                              description='Brak szczegółowych danych technicznych w dostarczonym materiale.',
                              load_notation=(friel.CORE_NOTE if name == friel.CORE else
                                             'Ciężar zewnętrzny w kg; 1RM według tej samej konwencji.')))
    phases, slots, goals = [], [], []
    for code, fields in friel.PHASES.items():
        phases.append(dict(id=code, code=code, is_demo=False, source=friel.SOURCE, **fields))
        for position, (title, category, default, allowed, parameters) in enumerate(friel._slots(code), 1):
            p = dict(friel.PARAMETERS[parameters], parameter_code=parameters)
            if parameters == 'AA':
                p['notes'] = friel.AA_LIMITATION
            if default == friel.CORE:
                p['basis'] = ''
                p['notes'] = p.get('notes', '') + ' ' + friel.CORE_NOTE
            if code == 'AA' and category == 'hip':
                p['notes'] = p.get('notes', '') + ' W pozycjach 1 i 3 wybierz różne warianty wyprostu biodra.'
            slots.append(dict(id=f'{code}-{position}', phase_id=code, position=position,
                              title=title, category=category, default_exercise_id=ids[default],
                              allowed_exercise_ids=[ids[n] for n in allowed], prescription=p))
    for name, low, high in [('Przysiad', '1.3', '1.7'),
                            (friel.SEATED_ROW, '0.5', '0.8'), (friel.STANDING_ROW, '0.4', '0.7')]:
        goals.append(dict(id='goal-' + ids[name], phase_id='SM', exercise_id=ids[name],
                          multiplier_min=low, multiplier_max=high, target_reps=6,
                          notes=friel.SM_LIMITATION, source=friel.SOURCE))
    phases.append(dict(id='DEMO', code='DEMO', name='DEMO — sprawdź aplikację', is_demo=True,
                       description='Przykładowe liczby do testów. Nie są zaleceniami Joe Friela.',
                       source='Dane DEMO aplikacji, nie zalecenia Joe Friela.'))
    for index, (name, mode, p) in enumerate([
        ('DEMO — przysiad', 'reps', dict(sets_min=2, sets_max=3, reps_min=8, reps_max=10,
                                       percent_min='50', percent_max='60', basis='rm', rest_seconds=60)),
        ('DEMO — wejście na stopień', 'reps', dict(sets_min=2, sets_max=2, reps_min=8, reps_max=8,
                                                percent_min='10', percent_max='20', basis='body', rest_seconds=60)),
        ('DEMO — deska', 'time', dict(sets_min=2, sets_max=2, seconds=30, basis='none', rest_seconds=45)),
    ], 1):
        eid = f'demo-ex-{index}'
        exercises.append(dict(id=eid, name=name, mode=mode, category='DEMO',
                              description='Ćwiczenie demonstracyjne, nie instruktaż techniki.',
                              load_notation='Dodatkowy ciężar w kg; dla deski brak obciążenia.'))
        slots.append(dict(id=f'DEMO-{index}', phase_id='DEMO', position=index, title=name, category='fixed',
                          default_exercise_id=eid, allowed_exercise_ids=[eid],
                          prescription=dict(**p, notes='Wyłącznie DEMO, nie zalecenia Joe Friela.')))
    return dict(exercises=exercises, phases=phases, slots=slots, goals=goals)


if __name__ == '__main__':
    target = ROOT / 'web/catalog.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(build(), ensure_ascii=False, indent=2, default=str) + '\n', encoding='utf-8')
    print(f'Zapisano {target.relative_to(ROOT)} (wyłącznie publiczny katalog).')
