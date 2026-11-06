# Weryfikacja wykonana 6 listopada 2026

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

Nie zweryfikowano programu Joe Friela: nie dostarczono materiałów. DEMO pozostaje oddzielnym zestawem technicznym. Nie wdrażano synchronizacji równoczesnych zmian z wielu urządzeń ani korekt zakończonych sesji.
