# Dane faz Joe Friela i granice materiałów

Źródłem danych początkowych jest [materiał dostarczony przez użytkownika](FRIEL_MATERIAL_UZYTKOWNIKA.md), opisany jako arkusz do książki Joe Friela „Biblia treningu kolarza górskiego”, tabele 13.1–13.7. Aplikacja odwzorowuje tę transkrypcję oraz podane w niej ograniczenia. Nie przedstawia jej jako niezależnie zweryfikowanego, pełnego odwzorowania książki. Krótkie opisy faz są objaśnieniami, nie cytatami.

## Dostępne dane

Publiczny katalog lokalnej PWA zawiera fazy AA — adaptacja anatomiczna, SM — siła maksymalna, WM — wytrzymałość mocy, WS — wytrzymałość siłowa i US — utrzymanie siły. Jest generowany z tej samej transkrypcji co migracje poprzedniej wersji Django. Fazy MT nie dodano. Zestaw DEMO pozostaje oddzielny od tych danych.

Każda faza zachowuje liczbę sesji i częstotliwość podane w materiale. Nie przeliczono ich na sztywną liczbę tygodni i nie dodano automatycznej zmiany fazy. Kolejność pozycji jest odrębna od wariantów ćwiczeń: wyprost biodra może oznaczać przysiad, wypychanie nogami albo step. „Osobiste słabości” są kategorią wyboru, nie fikcyjnym ćwiczeniem. W AA dwa wybrane ćwiczenia wyprostu biodra muszą być różne.

Faza planu i zestaw parametrów pozycji są przechowywane osobno. Pozycje pomocnicze w SM, WM, WS i US zachowują AA: 2–5 serii, 20–30 powtórzeń, 40–60% 1RM, powolne tempo, odpoczynek 60–90 s. Zakres serii dotyczy pojedynczego ćwiczenia. Oryginalne zapisy „3–6+” i „8–15+” są zachowane; „+” nie oznacza automatycznie treningu do upadku.

Obciążenia korzystają z własnego 1RM wybranego ćwiczenia. Zmiana wariantu nie przenosi 1RM ani mnożnika innego ćwiczenia. Jeżeli dla ćwiczenia tułowia lub innego wariantu nie ustalono sposobu zapisu obciążenia, aplikacja pokazuje brak danych i pozwala użytkownikowi ustawić własny parametr; masa ciała nie staje się automatycznie 1RM.

### Cele końcowe SM

Zakresy celu końcowego wynoszą: przysiad 1,3–1,7 × masa ciała, wiosłowanie na siedząco 0,5–0,8 × masa ciała i wiosłowanie na stojąco 0,4–0,7 × masa ciała. Dotyczą ciężaru na sześć powtórzeń pod koniec fazy. Są przechowywane i prezentowane oddzielnie od zaplanowanego ciężaru serii. Nie wybiera się automatycznie celu konkretnej osoby ani ciężaru pierwszego treningu. Po osiągnięciu celu materiał dopuszcza zachowanie ciężaru i zwiększanie liczby powtórzeń ponad sześć.

### Serie US

Przy dwóch seriach pierwsza ma 60%, druga 80% 1RM. Przy trzech seriach pierwsza ma 60%, trzecia 80% 1RM. Środkowa seria nie ma określonego w dostarczonym materiale obciążenia. Pozostaje oznaczona jako „Brak danych”, dopóki użytkownik świadomie nie ustawi własnego ciężaru. Wartości 70% nie dodano jako zalecenia źródłowego.

### Szacowanie 1RM

Oddzielny kalkulator korzysta ze współczynników tabeli 13.7 dla 4–10 powtórzeń. Wynik jest oznaczony jako szacowany, a zapis do profilu wymaga osobnego potwierdzenia. Zwykły zapis serii nie aktualizuje 1RM.

## Co pozostaje do uzupełnienia

| Materiał | Dlaczego jest potrzebny |
| --- | --- |
| Pełna tabela 13.3, w tym przypisy i zasady doboru celu | Pozwoli zweryfikować wybór celu SM dla konkretnej osoby; obecnie wyświetlany jest wyłącznie dostarczony zakres. |
| Mnożniki SM dla wypychania nogami, stepu i ewentualnych innych wariantów | Nie można stosować do nich mnożnika przysiadu. |
| Brakujący przypis AA ze strony 236 | Jego treści nie odtworzono z domysłów. |
| Obciążenie środkowej serii przy trzech seriach US, jeżeli inne materiały je określają | Obecna tabela go nie podaje; własny ciężar użytkownika pozostaje ustawieniem własnym. |
| Opisy techniki i konwencje zapisu obciążenia, których nie ma w transkrypcji | Nie dopisano niepotwierdzonych instrukcji wykonania ani interpretacji ciężaru. |
| Wydanie/rok książki i lokalizacja kompletnych tabel | Uzupełnią precyzyjną identyfikację źródła. |

W lokalnej PWA katalog aktualizuje się w pliku źródłowym `training/friel_data.py`, następnie poleceniami `python scripts/build_local_catalog.py` i `python scripts/build_local_release.py`. Nie ma wspólnego panelu administratora. Nowe dane trzeba przypisywać do właściwego ćwiczenia i źródła. Rozpoczęte sesje zachowują kopie parametrów i nie są przeliczane po zmianie programu. Istniejąca lokalna baza katalogu nie jest automatycznie nadpisywana nowym plikiem katalogu; aktualizacja danych źródłowych wymaga przygotowania osobnej migracji, by zachować własne plany i historię. Dawny panel Django pozostaje dostępny wyłącznie w archiwalnej wersji serwerowej.
