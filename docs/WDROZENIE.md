# Wdrożenie lokalnej PWA

Publikowany jest **tylko folder `web/`**: HTML, CSS, JavaScript, publiczne dane faz i ćwiczeń, manifest, ikony i service worker. Nie publikuj całego katalogu projektu, bazy SQLite ani kopii użytkowników. Serwer nie przechowuje treningów; profile i sesje są w IndexedDB urządzenia. Konta, poczta, Google OAuth i panel administratora nie są częścią tej wersji.

## Hosting statyczny

Po testach wykonaj `python scripts/build_local_release.py`, aby nowa zawartość dostała nową wersję cache. Pliki są już gotowe do umieszczenia na hostingu; nie wymagają instalowania zależności ani serwera Pythona online.

`render.yaml` opisuje **Render Static Site**, bez płatnego serwera Django i dysku SQLite. Utworzenie usługi wymaga własnego konta i zaakceptowania konfiguracji w panelu. Sprawdź aktualne ceny i limity. W tej zmianie nie utworzono ani nie opublikowano usługi.

Można połączyć repozytorium ręcznie przez **New → Static Site**:

| Pole | Wartość |
| --- | --- |
| Branch | gałąź zawierająca nową wersję |
| Build Command | `test -f web/index.html` |
| Publish Directory | `web` |
| Auto deploy | wyłączone |

Nie są potrzebne zmienne środowiska i sekrety. Hosting daje adres HTTPS; własną domenę można podpiąć później, zgodnie z rekordami DNS pokazanymi przez dostawcę. Dawny płatny blueprint Django jest w `deploy/render-django.yaml` wyłącznie jako archiwum.

Alternatywnie użyj Cloudflare Pages lub GitHub Pages. GitHub Pages nie pozwala wybrać folderu `web` w prostym publikowaniu z gałęzi (root/docs) — trzeba wdrożyć **artefakt folderu web**, np. akcją Pages. Repozytorium nie zawiera automatycznego workflow publikującego zmiany.

Adresy plików są względne, a ekrany mają trasy po `#`. Aplikacja obsługuje podkatalog, np. `https://uzytkownik.github.io/app_train_JF/`, bez przekierowań SPA. Zachowaj końcowy ukośnik katalogu. Serwer musi zwracać moduły `.mjs` jako JavaScript. Dla HTML i service workera nie ustawiaj długiego cache HTTP. Blueprint ustawia `no-cache`, `nosniff` i `no-referrer`; HTML ma CSP bez zewnętrznych skryptów, CDN i analityki.

## Telefon i offline

1. Otwórz aplikację online przez **HTTPS** i zaczekaj na **„Gotowa offline”**. Wszystkie wymagane pliki muszą zostać pobrane.
2. Android: instalacja z menu Chrome. iOS Safari: Udostępnij → Do ekranu początkowego.
3. Rozpocznij trening, wyłącz sieć, zapisz serię i odśwież. Sprawdź również zakończenie i historię bez sieci.
4. Pobierz JSON w Ustawieniach i sprawdź import na drugim urządzeniu.

`http://adres-komputera:8080` w Wi-Fi może wyświetlić interfejs, ale poza localhost nie zapewnia service workera i pełnej pracy offline. Potrzebne jest HTTPS. Po umieszczeniu plików na hostingu komputer nie musi być włączony.

## Dane i aktualizacje

Baza jest przypisana do protokołu, domeny, portu i przeglądarki. Inny port, domena albo przejście HTTP → HTTPS oznacza oddzielną bazę. Najpierw eksportuj pod starym adresem, potem importuj pod nowym. Import dodaje nowe profile, zachowuje obecne dane i nie scala równoczesnych edycji między urządzeniami.

W Ustawieniach sprawdź aktualizację, a potem wybierz jej zastosowanie. Cache aplikacji zostaje wymieniony; IndexedDB pozostaje. Zapisz serię przed aktualizacją. Nie czyść danych witryny. Przy zmianie domeny lub większej aktualizacji najpierw pobierz JSON.

IndexedDB może zostać usunięte przez czyszczenie przeglądarki, tryb prywatny, presję miejsca lub utratę telefonu. Przycisk trwałego przechowywania nie daje bezwarunkowej gwarancji. Kopię JSON przechowuj poza urządzeniem. Plik zawiera dane jawne, bez szyfrowania. Hosting może prowadzić zwykłe logi pobierania plików; aplikacja nie wysyła mu profili i serii.

## Przejście ze starej bazy

Zachowaj `db.sqlite3`. W starym venv uruchom `manage.py export_local_backup --output NOWY_PLIK.json`. Polecenie jest tylko do odczytu, pomija konta i odmawia zapisu do `web/` oraz nadpisania istniejącego pliku. Następnie zaimportuj plik w PWA. Obsługiwany jest pełny eksport schema 2.

Przed eksportem zsynchronizuj oczekujące zmiany starej aplikacji z Django. Stara lokalna kolejka nie jest odczytywana przez nową PWA. Zachowaj SQLite i JSON, dopóki nie sprawdzisz odtworzonej historii. Przed zastąpieniem starej strony pod tą samą domeną również przygotuj eksport — nowy service worker może zastąpić stary.
