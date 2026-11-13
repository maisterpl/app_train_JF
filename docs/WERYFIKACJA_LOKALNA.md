# Weryfikacja lokalnej PWA — 12 listopada 2026

Nowa aplikacja jest w `web/`. Poniższe wyniki dotyczą lokalnego Chromium i istniejącego środowiska Linux; nie oznaczają wdrożenia publicznego.

## Testy automatyczne

| Uruchomienie | Wynik | Zakres |
| --- | --- | --- |
| `npm test` | 27/27 | 1RM, masa ciała, zakresy, zaokrąglanie half-up, braki, walidacja, AA/US/SM, szacowanie 1RM, kolejność, numerowanie/idempotencja serii, historia i profile, zakończenie, migawki, JSON/CSV, import Django |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` | PASS | komputer 1440×1000 i telefon 390×844, zapis/edycja/usuwanie serii, wszystkie przyciski obciążenia, powtórzenia, ćwiczenie na czas, nawigacja i wznowienie |
| Ten sam test przeglądarkowy | PASS | odłączenie sieci, zapis, odświeżenie, zakończenie offline, ponowne otwarcie, brak formularza zakończonej sesji i odrzucenie dopisywania do niej |
| Ten sam test przeglądarkowy | PASS | równoczesny zapis z dwóch kart, prawdziwe wykresy kg/powtórzenia i sekund, JSON/CSV, import z podglądem, blokada powtórzonego pliku i odrzucenie uszkodzonego JSON bez zmiany bazy |
| Ten sam test przeglądarkowy | PASS | odtworzenie kopii w pustym kontekście przeglądarki, osiem gotowych pozycji AA, własne parametry i zachowanie pól po błędzie formularza |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:pwa-update` | PASS | adres w podkatalogu jak GitHub Pages, realna instalacja nowej wersji service workera i przeładowanie, usunięcie starego cache, zachowanie danych po aktualizacji i odświeżeniu offline, wycofanie częściowej zmiany po błędzie transakcji |
| `.venv/bin/python manage.py test --noinput` | 118/118 | regresja poprzedniej wersji Django oraz 3 nowe testy eksportera: wszystkie/jeden profil, brak modyfikacji źródła, odmowa nadpisania i zapisu do publicznego katalogu |

W testach przeglądarkowych nie odnotowano błędów JavaScript ani żądań POST. Kontrolowano, że nie występuje poziome przepełnienie strony. Obejrzano wygenerowane zrzuty interfejsu komputera i telefonu. Artefakty są domyślnie w folderze tymczasowym `sila-local-browser`.

Nowe testy reguł obejmują import pełnego eksportu Django z zakończonym treningiem, seriami i historycznymi obliczeniami oraz odrzucenie osieroconych rekordów. Dodatkowo uruchomiono eksporter na istniejącej lokalnej bazie: walidacja wyeksportowanej kopii przeszła (1 profil, 0 sesji). Baza źródłowa nie została zmieniona; tymczasowy plik z danymi usunięto po sprawdzeniu.

## Granice weryfikacji

- Ekran telefonu był emulowany w Chromium. Nie sprawdzono fizycznego Androida, Safari/iPhone ani instalacji przez App Store; aplikacja instaluje się jako PWA z przeglądarki.
- Testowano Linux, nie wykonano poleceń w Windows PowerShell. Nowe uruchomienie używa standardowego `http.server`, a testy Node nie mają zależności od Django.
- Nie utworzono hostingu, domeny, konta Render ani publicznego HTTPS. `localhost` umożliwia testowanie service workera, lecz nie zastępuje próby na docelowej domenie.
- Weryfikacja dotyczy IndexedDB i Cache API lokalnego Chromium. Uprawnienie do trwałego przechowywania, limity pamięci i usuwanie danych zależą od przeglądarki. Testy nie gwarantują ochrony po wyczyszczeniu witryny lub utracie urządzenia; potrzebne są kopie JSON.
- Nie ma automatycznej synchronizacji urządzeń ani połączenia z kontem Google. Jest to świadomie wybrana wersja lokalna.
- Pełna tabela 13.3, przypis AA ze strony 236 i inne wymienione braki materiałów Friela pozostają nieuzupełnione. Parametrów nie dopowiedziano.

## Ponowne uruchomienie

Wykonaj `npm ci`, `npm test`, `npx playwright install chromium`. Uruchom `python -m http.server 8080 --bind 127.0.0.1 --directory web` i w drugim terminalu `npm run test:browser`. Test aktualizacji `npm run test:pwa-update` uruchamia własny tymczasowy serwer. Na Linux można wskazać systemowe Chromium zmienną `CHROMIUM_PATH`; bez niej używana jest przeglądarka pobrana przez Playwright.

## Zapamiętywanie ciężaru — 13 listopada 2026

`npm test`: 27/27 PASS. Rozszerzony `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`: PASS na komputerze 1440×1000 i emulowanym telefonie 390×844.

Sprawdzono podpowiadanie ostatniego ciężaru po zapisie kolejnej serii, odświeżeniu offline i rozpoczęciu następnego treningu; wartość 0 kg; zachowanie ręcznego wpisu przy zmianie ćwiczenia; pierwszeństwo wartości edytowanej serii; rozdzielenie profili. Sprawdzono też US: pierwsza seria 60% 1RM, ostatnia 80%, brak automatycznego ciężaru środkowej serii. Nadal przechodzą scenariusze zapisu offline, zakończenia, wykresów i eksportu/importu. Wersja cache PWA została odświeżona.

Rozszerzenie tego samego dnia: pola powtórzeń korzystają z ostatniej zapisanej serii lub poprzedniego treningu. `npm test`: 27/27 PASS. Testy przeglądarkowe na obu ekranach: PASS dla podpowiadania powtórzeń po zapisie i odświeżeniu offline, początku kolejnego treningu, wartości 0, pierwszeństwa ręcznego wpisu/edycji oraz oddzielnych profili. Sprawdzono także zapamiętywanie powtórzeń w US przy zachowaniu osobnych obciążeń serii. Ćwiczenia na czas nadal mają pole sekund. Cache PWA otrzymał nową wersję.

## Własne plany, ćwiczenia i usuwanie — 13 listopada 2026

- `npm test`: **35/35 PASS**. Nowe reguły obejmują dodawanie ćwiczeń i wykrywanie duplikatów, własne parametry, obliczenia z 1RM i masy ciała, ćwiczenia na czas, walidację wymaganych wartości i zakresów, zachowanie starych planów i migawek, eksport/import nowych danych oraz usuwanie planu z zachowaniem zakończonych i aktywnych sesji.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:custom`: **PASS** na komputerze 1440×1000 i emulowanym telefonie 390×844. Formularze tworzenia i edycji, serie/powtórzenia/czas/odpoczynek/procenty/uwagi, własne ćwiczenia z listy i bezpośrednio z planu, duplikaty bez utraty pól, kolejność, trening offline, niezmienność historii, potwierdzenie i anulowanie usunięcia, wznowienie sesji po usunięciu jej planu, eksport/import i odświeżenie offline.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`: **PASS** na obu ekranach. Dotychczasowe fazy, podpowiadanie ciężaru/powtórzeń, historia, wykresy i wcześniejsze scenariusze offline nadal działają.

Testy porównują istniejący plan, fazy i pozycje źródłowe przed i po dodawaniu własnych danych — pozostają bez zmian. Obejrzano zrzut własnego planu na ekranie telefonu. Nie odnotowano błędów JavaScript ani żądań POST z danymi treningowymi. Zachowano ograniczenia weryfikacji opisane wyżej: bez fizycznego telefonu, Safari i publicznego hostingu.
