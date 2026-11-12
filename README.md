# Siła na trasę — lokalna PWA dla kolarza

Aktualna aplikacja jest w **`web/`**. To samodzielne HTML, CSS i JavaScript, z całą bazą treningową w **IndexedDB na urządzeniu użytkownika**. Nie potrzebuje Django, kont, SMTP, Google OAuth ani serwera bazy danych. Hosting udostępnia tylko publiczne pliki aplikacji i katalog ćwiczeń.

Nie ma automatycznej synchronizacji telefonu z komputerem ani dostępu administratora do cudzych danych. Do przenoszenia służy **eksport/import JSON**. Profile oddzielają osoby lokalnie; nie są uwierzytelnianiem. Osoba z dostępem do tej samej przeglądarki może je przełączać.

## Uruchomienie — Windows PowerShell

Zainstaluj Python 3.13, otwórz terminal w katalogu projektu:

```powershell
py -3.13 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Otwórz **http://localhost:8080/**. Nie otwieraj pliku przez `file://`. Nowa wersja nie wymaga venv, zależności Pythona, migracji ani administratora. Wygenerowane pliki są już w repozytorium.

Dodaj profil, pomiar masy ciała i swoje wartości 1RM. W **Plany** wybierz AA, SM, WM, WS lub US, zaznacz ćwiczenia, dobierz warianty i zapisz plan. Możesz też użyć **Wypróbuj dane DEMO**: powstanie osobny profil z przykładowymi liczbami, które nie są zaleceniami Friela.

## Dostępne funkcje

- Profile, ich edycja, masa ciała z datą, historia ręcznych i świadomie zatwierdzonych szacowanych 1RM.
- Pięć faz z materiałów użytkownika, gotowe pozycje i warianty; parametry pomocnicze AA, oddzielne cele SM i ciężary poszczególnych serii US. Brakujące dane są oznaczone.
- Wybór ćwiczeń do planu, kolejność góra/dół, usuwanie pozycji, edycja parametrów, przywrócenie zaleceń fazy, ponowne użycie planu.
- Obciążenie z procentu 1RM albo masy ciała, zakresy, zaokrąglanie i ręczne zmiany. Obliczenia procentowe używają arytmetyki całkowitej, bez błędów ułamków zmiennoprzecinkowych.
- Jedno ćwiczenie na ekranie, ciężar ±1/5/10 kg, powtórzenia/czas, zapis/edycja/usuwanie serii, notatki, odpoczynek, nawigacja, pomijanie, wznowienie i zakończenie.
- Kopia parametrów, pomiarów i zaleceń w sesji. Późniejsze zmiany nie przeliczają historii. Zakończone sesje są zablokowane do edycji.
- Historia ćwiczeń i prawdziwy wykres maksymalnego ciężaru z kontekstem powtórzeń; dla ćwiczeń na czas — sekundy. Punkt otwiera sesję, pod wykresem jest tabela.
- Cała aplikacja offline po pierwszym przygotowaniu, także tworzenie planów i profili. Komunikat zapisu pojawia się po zatwierdzeniu transakcji IndexedDB. Zapisy z dwóch kart są szeregowane.
- Eksport wszystkich danych lub aktywnego profilu do JSON, import z podglądem i walidacją, wyniki do CSV (Excel, separator `;`).

## Kopie zapasowe i przenoszenie

1. **Ustawienia → Eksportuj wszystko · JSON** lub eksport aktywnego profilu.
2. Sprawdź pobrany plik i zachowaj go poza przeglądarką, np. w prywatnym folderze kopii. Plik zawiera czytelne, nieszyfrowane dane treningowe.
3. Na drugim urządzeniu otwórz aplikację i wybierz **Ustawienia → Importuj kopię zapasową**.
4. Sprawdź podgląd, następnie **Importuj jako nowe profile**.

Import dodaje profile z dopiskiem „(import)”, zachowując istniejące dane. Nie scala dwóch równolegle edytowanych historii. Dokładnie ten sam plik można zaimportować tylko raz do danej bazy. Identyczne publiczne definicje są współdzielone; odmienne konwencje ćwiczeń pozostają osobne. CSV służy do analizy, nie do odtwarzania bazy. Maksymalny plik importu: 20 MB. Wadliwy format, nieznane wersje i niepoprawne powiązania są odrzucane przed zapisem.

**Baza jest przypisana do protokołu, domeny, portu i przeglądarki.** `localhost`, `127.0.0.1`, inny port i nowa domena mają oddzielne dane. Wyczyszczenie danych witryny, tryb prywatny lub utrata telefonu mogą usunąć historię. Przycisk trwałego przechowywania prosi przeglądarkę o ochronę przed automatycznym usuwaniem; decyzja należy do przeglądarki. Instalacja PWA nie zastępuje eksportu.

## Telefon, domena i hosting

Opublikuj **wyłącznie zawartość `web/`** na hostingu statycznym z HTTPS, np. GitHub Pages, Cloudflare Pages lub Render Static Site. Własna domena jest opcjonalna; hosting może udostępnić swój adres. Dostępność bezpłatnego planu zależy od aktualnych warunków dostawcy. Nie dodawaj prywatnych baz i eksportów do repozytorium ani hostingu.

Na telefonie otwórz HTTPS online i zaczekaj na **„Gotowa offline”**. Potem dodaj aplikację do ekranu głównego (Android: instalacja z menu przeglądarki, iOS Safari: Udostępnij → Do ekranu początkowego). Wyłącz sieć, otwórz ją ponownie i zapisz serię. Komputer nie musi być włączony przy korzystaniu z hostingu statycznego.

Samo otwarcie `http.server` w Wi-Fi nie zapewnia pełnej PWA: poza `localhost` service worker wymaga **HTTPS**. Kod aplikacji nie wysyła treningów na serwer. Hosting może prowadzić zwykłe logi dostępu do plików, np. adres IP.

Aktualizację sprawdza się i stosuje w Ustawieniach. Nie usuwa ona IndexedDB. Zmiana domeny wymaga wcześniejszego eksportu pod starym adresem i importu pod nowym. Szczegóły: [wdrożenie](docs/WDROZENIE.md). W ramach tej zmiany niczego nie opublikowano i nie kupiono.

## Przejście z Django

Stary kod, migracje i lokalna baza pozostają zachowane jako źródło migracji; nie są potrzebne nowej PWA. Nie usuwaj starej bazy przed sprawdzeniem kopii i importu.

Pobierz JSON aktywnego profilu z Ustawień starej wersji albo wyeksportuj wszystkie profile w istniejącym venv:

```powershell
.\.venv\Scripts\python.exe manage.py export_local_backup --output "$env:USERPROFILE\Desktop\sila-backup.json"
# Opcjonalnie tylko jeden profil:
.\.venv\Scripts\python.exe manage.py export_local_backup --profile 1 --output "$env:USERPROFILE\Desktop\profil-backup.json"
```

Polecenie nie zmienia bazy. Odmawia nadpisania pliku i zapisu do publicznego `web/`. Stara baza musi mieć dotychczasowy schemat migracji. Zaimportuj plik w Ustawieniach nowej aplikacji. Obsługiwany jest pełny eksport Django **schema 2**, także aktywne sesje i kopie historycznych parametrów. Konta, maile i uprawnienia nie są przenoszone.

Najpierw zsynchronizuj oczekujące zmiany starej przeglądarkowej wersji Django z jej serwerem. Lokalna kolejka starej wersji nie jest objęta eksportem SQLite. Nie czyść starych danych przed synchronizacją. Archiwalna instrukcja: [README Django](README_DJANGO.md).

## Testy — PowerShell

Node.js jest potrzebny tylko do testów (22 LTS lub nowszy):

```powershell
npm ci
npm test
npx playwright install chromium
```

W dwóch terminalach:

```powershell
# Terminal 1:
py -3.13 -m http.server 8080 --bind 127.0.0.1 --directory web
# Terminal 2:
npm run test:browser
# Osobny test aktualizacji PWA i pracy w podkatalogu:
npm run test:pwa-update
```

Można podać własne Chromium: `$env:CHROMIUM_PATH = "C:\sciezka\do\chrome.exe"`. Na Linux: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. Wyniki i ograniczenia: [weryfikacja](docs/WERYFIKACJA_LOKALNA.md). Testy starego Django są oddzielne: `python manage.py test`.

## Katalog i wydanie

Katalog jest generowany z istniejącej transkrypcji `training/friel_data.py`, bez odczytu prywatnej bazy. Po zmianach danych lub kodu:

```powershell
py -3.13 scripts/build_local_catalog.py
py -3.13 scripts/build_local_release.py
npm test
```

Drugi skrypt tworzy ikony PNG i wersję cache zależną od zawartości plików. Opublikuj gotowy folder `web/`. Nie zmieniaj schematu danych bez przygotowania migracji/importera; aplikacja nie resetuje automatycznie nieobsługiwanej bazy.

[Źródła i brakujące materiały Friela](docs/FRIEL_DANE.md): pełna tabela 13.3 z przypisami, przypis AA ze strony 236, mnożniki SM dla stepu i wypychania nogami, ewentualne źródłowe obciążenie środkowej serii US, opisy techniki/konwencje ciężaru oraz dokładne wydanie książki. Nie wymyślono brakujących zaleceń.
