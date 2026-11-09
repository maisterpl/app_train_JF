# Materiał użytkownika — fazy treningu siłowego

Źródło implementacji: tekst dostarczony przez użytkownika do projektu 6 listopada 2026, opisany jako materiał do książki Joe Friela „Biblia treningu kolarza górskiego”, tabele 13.1–13.7. Poniżej zachowano treść materiału, normalizując jedynie zakończenia linii. To zapis dostarczonej transkrypcji i jej ograniczeń; nie jest niezależną weryfikacją pełnej książki ani brakujących przypisów.

---

Zaimplementuj opisane poniżej fazy treningu siłowego w aplikacji. Dane pochodzą z materiałów użytkownika do książki Joe Friela „Biblia treningu kolarza górskiego”, z tabel 13.1–13.7.

Zachowaj nazwy i skróty:
- AA — adaptacja anatomiczna;
- SM — siła maksymalna;
- WM — wytrzymałość mocy;
- WS — wytrzymałość siłowa;
- US — utrzymanie siły.

Nie dodawaj fazy MT. Nie traktuj wszystkich ćwiczeń w danej fazie jako wykonywanych według identycznych parametrów. Część ćwiczeń pomocniczych zachowuje parametry AA.

OPISY FAZ

AA przygotowuje organizm do późniejszych, większych obciążeń. W aplikacji przedstaw ją jako etap nauki i utrwalania techniki oraz stopniowego przyzwyczajania do treningu siłowego.

SM służy rozwijaniu zdolności do pokonywania większego oporu. Obciążenie zwiększa się stopniowo, a cele wyrażone względem masy ciała dotyczą końca fazy.

WM służy rozwijaniu zdolności do wielokrotnego wykonywania dynamicznych ruchów. Wyróżnikiem jest szybkie podnoszenie przy mniejszym obciążeniu niż w treningu siły maksymalnej.

WS służy rozwijaniu zdolności do powtarzania pracy siłowej przy narastającym zmęczeniu. Wyróżnia ją duża liczba powtórzeń.

US służy podtrzymaniu wcześniej zbudowanej siły przy ograniczonej częstotliwości treningów.

Powyższe opisy są krótkimi objaśnieniami dla użytkownika, a nie cytatami z książki.

1. AA — ADAPTACJA ANATOMICZNA

Parametry:
- 8–12 sesji w fazie;
- 2–3 sesje tygodniowo;
- 2–5 serii na ćwiczenie;
- 20–30 powtórzeń w serii;
- 40–60% 1RM;
- tempo: powoli;
- odpoczynek między seriami: 60–90 sekund.

Kolejność pozycji:
1. Ćwiczenie wyprostu biodra — w przygotowanym arkuszu domyślnie przysiad.
2. Ściąganie do klatki piersiowej na siedząco.
3. Drugie ćwiczenie wyprostu biodra — w arkuszu domyślnie wypychanie nogami.
4. Wyciskanie na ławce.
5. Wiosłowanie na siedząco.
6. Ćwiczenie ukierunkowane na osobiste słabości — w arkuszu domyślnie uginanie nóg leżąc.
7. Wiosłowanie na stojąco.
8. Skłony ze skrętem.

W pozycjach 1 i 3 wybiera się różne ćwiczenia wyprostu biodra. W bazie uwzględnij przysiad, wypychanie nogami i step jako dostępne warianty tej kategorii.

„Osobiste słabości” oznaczają pozycję z wyborem ćwiczenia, a nie nazwę osobnego ćwiczenia.

Wszystkie powyższe pozycje mają parametry AA. Nie traktuj zakresu 2–5 jako łącznej liczby serii całego treningu.

2. SM — SIŁA MAKSYMALNA

Parametry ćwiczeń głównych:
- 8–12 sesji w fazie;
- 2–3 sesje tygodniowo;
- 2–6 serii;
- 3–6+ powtórzeń;
- tempo: powoli do średnio;
- odpoczynek: 120–240 sekund.

Kolejność:
1. Wyprost biodra: przysiad, wypychanie nogami albo step — parametry SM.
2. Wiosłowanie na siedząco — parametry SM.
3. Skłony ze skrętem — parametry AA.
4. Ćwiczenie obręczy barkowej: wyciskanie na ławce albo ściąganie do klatki piersiowej na siedząco — parametry AA.
5. Osobiste słabości: uginanie nóg leżąc, prostowanie nóg w siadzie albo wspięcia na palce — parametry AA.
6. Wiosłowanie na stojąco — parametry SM.

Zasady obciążenia:
- cele siłowe wyraża się jako wielokrotność masy ciała;
- dotyczą osiągnięcia ciężaru na 6 powtórzeń pod koniec fazy;
- nie są automatycznie zalecanym ciężarem pierwszego treningu;
- po osiągnięciu celu zachowuje się ciężar i można zwiększać liczbę powtórzeń ponad 6.

W naszym arkuszu zapisano następujące zakresy celów:
- przysiad: 1,3–1,7 × masa ciała;
- wiosłowanie na siedząco: 0,5–0,8 × masa ciała;
- wiosłowanie na stojąco: 0,4–0,7 × masa ciała.

W aplikacji przechowuj je jako „zakres celu końcowego”, oddzielnie od faktycznie zaplanowanego ciężaru serii.

Nie wybieraj automatycznie dolnej ani górnej wartości jako celu konkretnej osoby bez zweryfikowania zasad doboru w tabeli źródłowej 13.3. Nie przenoś mnożnika przysiadu na wypychanie nogami ani step. Mnożniki pozostałych wariantów należy uzupełnić z tabeli źródłowej.

3. WM — WYTRZYMAŁOŚĆ MOCY

Parametry ćwiczeń głównych:
- 6–8 sesji w fazie;
- 1–2 sesje tygodniowo;
- 2–3 serie;
- 8–15+ powtórzeń;
- 40–60% 1RM;
- tempo: szybko;
- odpoczynek: 180–300 sekund.

Kolejność i przypisanie:
1. Wyprost biodra — parametry WM.
2. Wiosłowanie na siedząco — parametry WM.
3. Skłony ze skrętem — parametry AA.
4. Ćwiczenie obręczy barkowej — parametry AA.
5. Osobiste słabości — parametry AA.
6. Wiosłowanie na stojąco — parametry WM.

Zachowaj znak „+” w opisie powtórzeń. Nie zamieniaj go na dowolną liczbę ani nie interpretuj automatycznie jako treningu do upadku.

4. WS — WYTRZYMAŁOŚĆ SIŁOWA

Parametry ćwiczeń głównych:
- 4–8 sesji w fazie;
- 1 sesja tygodniowo;
- 1–3 serie;
- 40–60 powtórzeń;
- 30–50% 1RM;
- tempo: średnio;
- odpoczynek: 60–120 sekund.

Kolejność i przypisanie:
1. Wyprost biodra — parametry WS.
2. Wiosłowanie na siedząco — parametry WS.
3. Skłony ze skrętem — parametry AA.
4. Ćwiczenie obręczy barkowej — parametry AA.
5. Osobiste słabości — parametry AA.
6. Wiosłowanie na stojąco — parametry WS.

Nie przypisuj 40–60 powtórzeń ćwiczeniom pomocniczym, które mają zachować parametry AA.

5. US — UTRZYMANIE SIŁY

Parametry ćwiczeń głównych:
- liczba sesji w fazie: bez określonego limitu;
- 1 sesja tygodniowo;
- 2–3 serie;
- 6–12 powtórzeń;
- pierwsza seria: 60% 1RM;
- ostatnia seria: 80% 1RM;
- tempo: średnio;
- odpoczynek: 60–120 sekund.

Kolejność i przypisanie:
1. Wyprost biodra — parametry US.
2. Wiosłowanie na siedząco — parametry US.
3. Skłony ze skrętem — parametry AA.
4. Ćwiczenie obręczy barkowej — parametry AA.
5. Osobiste słabości — parametry AA.
6. Wiosłowanie na stojąco — parametry US.

Obciążenie musi być przypisane do konkretnej serii:
- przy 2 seriach: pierwsza 60%, druga 80% 1RM;
- przy 3 seriach: pierwsza 60%, trzecia 80% 1RM;
- obciążenie drugiej serii przy 3 seriach nie zostało określone w dostępnej tabeli.

Nie wpisuj samodzielnie 70% jako zalecenia książki. Pozwól użytkownikowi ustalić obciążenie środkowej serii i oznacz je jako ustawienie własne.

6. WSPÓLNE PARAMETRY ĆWICZEŃ POMOCNICZYCH

Jeżeli pozycja zachowuje parametry AA, obowiązuje:
- 2–5 serii;
- 20–30 powtórzeń;
- 40–60% 1RM;
- tempo powolne;
- przerwa 60–90 sekund.

Przechowuj osobno:
- fazę całego planu, np. SM;
- zestaw parametrów konkretnej pozycji, np. AA.

Dzięki temu trening SM może zawierać ćwiczenia główne SM oraz pomocnicze AA.

Dla wariantów takich jak pompki lub ćwiczenia tułowia nie podstawiaj automatycznie masy ciała jako 1RM. Jeżeli nie ustalono sposobu określania obciążenia, pokaż brak danych i pozwól ustawić parametr ręcznie.

7. OPCJONALNE SZACOWANIE 1RM — TABELA 13.7

Oprócz ręcznego wpisania 1RM przygotuj osobny kalkulator oparty na ciężarze i liczbie powtórzeń wykonanych do granicy możliwości:

| Powtórzenia | Współczynnik |
|---|---|
| 4 | 0,900 |
| 5 | 0,875 |
| 6 | 0,850 |
| 7 | 0,825 |
| 8 | 0,800 |
| 9 | 0,775 |
| 10 | 0,750 |

Wzór:
szacowane 1RM = ciężar / współczynnik.

Przykład:
80 kg przy 8 powtórzeniach → 80 / 0,8 = 100 kg.

Oznacz wynik jako szacowany. Zapis do profilu wymaga świadomego działania użytkownika. Zwykły zapis serii treningowej nie może automatycznie aktualizować 1RM.

8. ZASADY IMPLEMENTACJI

- Utwórz powyższe fazy i przypisania jako dane początkowe aplikacji.
- Zachowaj kolejność ćwiczeń.
- Oddziel kategorie pozycji od wybranego wariantu ćwiczenia.
- Dla zmienionego wariantu używaj jego własnej wartości 1RM.
- Przechowuj dolną i górną granicę parametrów, zamiast wpisywać wyłącznie tekst zakresu.
- Zachowaj również oryginalny zapis powtórzeń ze znakiem „+”.
- Przechowuj tempo opisowo. Nie zamieniaj „powoli” na wymyślony zapis sekundowy.
- Nie zmieniaj liczby sesji w fazie na sztywną liczbę tygodni.
- Nie ustawiaj automatycznego przechodzenia między fazami wyłącznie na podstawie liczby wykonanych treningów.
- Rozróżniaj zalecenie, cel końcowy oraz faktycznie wykonany wynik.
- Umożliwiaj zmianę parametrów planu, zachowując informację o ustawieniu własnym.
- Nie generuj brakujących mnożników ani przypisów.

OGRANICZENIA MATERIAŁÓW

Dostępny arkusz wskazuje brak przypisu do fazy AA ze strony 236. Nie odtwarzaj jego treści z domysłów.

Przed uznaniem bazy za pełne odwzorowanie książki trzeba zweryfikować kompletną tabelę celów SM 13.3 i brakujący przypis AA. Pozostałe elementy aplikacji implementuj bez czekania na te uzupełnienia.
