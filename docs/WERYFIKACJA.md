# Weryfikacja aplikacji

## Aktualizacja faz Friela — 9 listopada 2026

Po przywróceniu środowiska uruchomiono pełny zestaw: **80 testów Django, wszystkie poprawne**, na Pythonie 3.12.14 i 3.13.17. Migracje 0004 i 0005 są zastosowane, `check` nie zgłasza problemów, a `makemigrations --check --dry-run` nie wykrywa brakujących migracji.

Nowe testy obejmują pięć faz, 32 pozycje, kolejność i warianty, osobne parametry AA, zapis „+”, cele SM oddzielone od ciężaru treningowego, obciążenia kolejnych serii US, brak domyślnych 70%, świadomy zapis szacowanego 1RM i zachowanie wcześniejszych kopii treningów.

W Chromium ponownie przeszły oba scenariusze `browser_smoke.cjs` (komputer i telefon/offline) oraz cztery przypadki `browser_sync_edges.cjs`. Dodatkowo `browser_friel.cjs` zakończył się poprawnie we wszystkich sześciu sprawdzanych przypadkach: US z dwoma seriami i własnym 1RM wariantu, własny środkowy ciężar, US z trzema seriami offline i synchronizacją, osobny cel SM i pomocnicze AA, brak celu dla nieznanego wariantu oraz własne powtórzenia z zachowaniem oryginalnego zapisu źródłowego.

Dane odwzorowują materiał dostarczony przez użytkownika; pełna tabela 13.3 oraz przypis AA ze strony 236 pozostają do uzupełnienia. Nie przeprowadzono niezależnej weryfikacji pełnej książki. Ograniczenia dotyczące fizycznego Windows, telefonu i Safari/iOS opisane niżej nadal obowiązują.

Poniżej zachowano raport pierwszej wersji z 6 listopada 2026.

## Uruchomione środowisko

- Django 5.2.19 LTS, SQLite, Linux x86_64.
- Python 3.12.14 i osobne środowisko Python 3.13.17.
- Zainstalowano zależności z `requirements.txt`, wykonano migracje, `check`, `collectstatic` i `seed_demo`. Ponowne uruchomienie instalacji oraz polecenia DEMO nie wymaga kasowania bazy.
- `makemigrations --check --dry-run`: brak niezapisanych zmian modeli.
- Serwer Django uruchomiono; żądania do głównych widoków, API, eksportów i zasobów PWA zakończyły się poprawnie.

## Testy serwera

`python manage.py test` — **47 testów, wszystkie poprawne**. Sprawdzają m.in. procent 1RM i masy, zakresy, krok zaokrąglania, brak danych, daty pomiarów, niezmienność kopii, kolejność, numerację, edycję i usuwanie, rozdzielenie profili, CSRF, transakcje, idempotencję, zakończenie i blokadę historii oraz formularze planu i profilu.

## Testy Chromium

Chromium 156, Playwright 1.62.1. `scripts/browser_smoke.cjs` zakończony poprawnie w dwóch wariantach:

- komputer: 1440 × 1000;
- telefon emulowany: 390 × 844, dotyk.

Sprawdzono pierwsze i kolejne ćwiczenie, przyciski ciężaru i powtórzeń, kilka serii, edycję/usunięcie, odpoczynek, poprzednie/następne ćwiczenie, pominięcie, odświeżenie, zakończenie i brak formularza po zakończeniu. Kontrola szerokości nie wykazała poziomego przepełnienia układu Start, planu i treningu.

W wariancie mobilnym przygotowano sesję przez interfejs, wyłączono połączenie w kontekście przeglądarki, zapisano i edytowano serie, odświeżono stronę, otwarto ponownie adres startowy PWA bez sieci, zakończono offline i przywrócono połączenie. Sprawdzono opróżnienie kolejki po potwierdzeniu i rzeczywiste dane Django, nie tylko lokalny komunikat.

`scripts/browser_sync_edges.cjs` — **4 przypadki poprawne**:

1. Serwer zapisał serię, ale odpowiedź zaginęła: kolejka pozostała, ponowienie nie utworzyło duplikatu.
2. Nowsza edycja podczas odpowiedzi na starszą zmianę przetrwała i dotarła na serwer.
3. Odpowiedź serwera nie zastąpiła edytowanego pola DOM, nie utraciła wpisywanych wartości, fokusu ani zaznaczenia.
4. Rzeczywiste podwójne kliknięcie online i offline utworzyło po jednej serii.

## Granice weryfikacji

Nie uruchamiano projektu na fizycznym Windows, fizycznym telefonie ani w Safari/iOS. Python 3.13 został uruchomiony i przetestowany na Linux. Mobilny Chromium jest emulacją, nie testem konkretnego urządzenia. Nie konfigurowano domeny i certyfikatu HTTPS użytkownika ani instalacji na jego ekranie głównym; te kroki opisuje README. Zachowanie magazynu po usunięciu danych witryny lub automatycznym czyszczeniu przez system nie jest gwarantowane.

W pierwszej wersji z 6 listopada nie dostarczono jeszcze materiałów Joe Friela i dostępne było wyłącznie DEMO. Późniejszą implementację dostarczonych danych opisuje aktualizacja powyżej. DEMO pozostaje oddzielnym zestawem technicznym. Nie wdrażano synchronizacji równoczesnych zmian z wielu urządzeń ani korekt zakończonych sesji.
