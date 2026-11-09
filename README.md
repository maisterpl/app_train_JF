# Trening siłowy dla kolarza

Lokalna aplikacja Django do planowania treningów, obliczania obciążeń, zapisu serii i oglądania historii. Interfejs jest po polsku i dostosowany do komputera oraz telefonu. SQLite przechowuje dane serwera; IndexedDB przechowuje przygotowaną sesję i kolejkę zmian na urządzeniu.

Projekt używa Django 5.2 LTS, zgodnego z Pythonem 3.13. Wersja zależności jest zapisana w `requirements.txt`. Profile reprezentują osoby i oddzielają ich wyniki, pomiary oraz plany. Nie są kontami z hasłem i nie zapewniają ochrony przed inną osobą mającą dostęp do aplikacji.

## Uruchomienie w Windows PowerShell

Otwórz terminal w folderze projektu. Zainstaluj Python 3.13, a następnie wykonaj:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_demo
python manage.py runserver
```

Otwórz `http://127.0.0.1:8000/`. Panel zarządzania bazą ćwiczeń, faz i zaleceń jest pod `/admin/`; zaloguj się administratorem utworzonym powyżej. Jeśli PowerShell blokuje aktywację venv, zamiast zmieniać politykę systemową możesz używać pełnej ścieżki interpretera:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

W VS Code wybierz interpreter `.venv\Scripts\python.exe`. Po kolejnej zmianie kodu zwykle wystarczą aktywacja środowiska, `python manage.py migrate` i `python manage.py runserver`.

## Konfiguracja

`.env.example` opisuje dostępne ustawienia bez sekretów. Django czyta zmienne procesu; plik `.env` nie jest wczytywany automatycznie. Przykład dla sesji PowerShell:

```powershell
$env:DJANGO_SECRET_KEY = "lokalny-klucz-zmien-na-wlasny"
$env:DJANGO_DEBUG = "1"
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1"
python manage.py runserver
```

Przy udostępnianiu aplikacji ustaw własny trwały `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, właściwe hosty i zaufane źródła CSRF. Nie publikuj sekretów w repozytorium. Domyślna baza to `db.sqlite3` w katalogu projektu.

## Codzienny przebieg treningu

1. W sekcji **Profil** utwórz osobę, wybierz aktywny profil i dodaj pomiar masy z datą.
2. W **Ćwiczeniach** zapisz ręcznie wartości 1RM, jeżeli wybrany plan ich wymaga. Zapis serii nie aktualizuje 1RM.
3. W **Planach** utwórz plan i wybierz fazę. Dodaj wybrane ćwiczenia z jej zaleceń, ustaw kolejność i ewentualnie zmień parametry planu. Ręczne zmiany są odróżnione od zaleceń fazy.
4. Uruchom plan lub przygotuj go do treningu offline. Przygotowanie offline tworzy rozpoczętą sesję z kopią danych; nie jest tylko zapisaniem nazwy planu.
5. Zapisuj serie, przechodź między ćwiczeniami, poprawiaj błędne wpisy i zakończ trening. Po odświeżeniu można wznowić aktywną sesję.
6. W **Treningach** sprawdzaj historię, a w szczegółach ćwiczenia rzeczywisty progres oraz historię 1RM.

Obliczenia rozróżniają procent 1RM i procent masy ciała. Wykorzystują najnowszy pomiar dostępny na wybrany **dzień treningu** (`training_date`). Jest on oddzielony od rzeczywistego momentu rozpoczęcia sesji (`started_at`), dzięki czemu wybór daty nie fałszuje czasu trwania treningu. Brak pomiaru jest komunikatem do uzupełnienia danych, nie zerowym obciążeniem. Krok zaokrąglania jest ustawieniem profilu. Ciężar wykonanej serii można zmienić ręcznie.

Rozpoczęta sesja zachowuje kopię parametrów, masy, 1RM i wyliczeń. Zmiana planu lub późniejszy pomiar nie przelicza historii. Zakończona sesja nie przyjmuje nowych serii przez endpoint aktywnego treningu. W tej wersji nie ma odrębnego narzędzia korekty zakończonych treningów.

## Fazy z materiałów użytkownika i DEMO

Migracje automatycznie dodają pięć faz: **AA — adaptacja anatomiczna**, **SM — siła maksymalna**, **WM — wytrzymałość mocy**, **WS — wytrzymałość siłowa**, **US — utrzymanie siły**. Dane odwzorowują dostarczony przez użytkownika opis tabel 13.1–13.7 z „Biblii treningu kolarza górskiego”. Nie dodano fazy MT. Materiał źródłowy i ograniczenia zapisano w [dokumentacji danych](docs/FRIEL_DANE.md).

Gotowe ćwiczenia znajdziesz w **Plany → Gotowe zestawy Friela**: AA ma 8 pozycji, a SM, WM, WS i US po 6. Każdy zestaw pokazuje ćwiczenia domyślne i źródłowy zestaw parametrów. Użyj **Przygotuj plan AA/SM/WM/WS/US**, zapisz nazwę, a następnie zatwierdź domyślnie zaznaczone pozycje lub odznacz niepotrzebne i zmień warianty. W US jawnie wybierasz 2 albo 3 serie ćwiczeń głównych. Zestawy faz są wspólną bazą; zapisane plany należą do aktywnego profilu.

Sama zmiana fazy już istniejącego planu nie zastępuje jego ćwiczeń. Aby skorzystać z pełnego zestawu innej fazy, przygotuj nowy plan z jej karty. Do istniejącego planu można też świadomie dodać pozycje przyciskiem **Dodaj ćwiczenia**.

Faza ma liczbę sesji i częstotliwość tygodniową, a każda pozycja własny zestaw parametrów. Plan SM, WM, WS lub US może zawierać główne ćwiczenia tej fazy oraz pomocnicze z parametrami AA. Zakresy nie są automatycznie przeliczane na tygodnie, a aplikacja nie zmienia fazy po ustalonej liczbie treningów.

Przy dodawaniu ćwiczeń wybierz pozycje i ich warianty. Dwa wyprosty biodra w AA wymagają różnych ćwiczeń. „Osobiste słabości” to kategoria wyboru, nie osobne ćwiczenie. Po zmianie wariantu obciążenia korzystają z jego własnego 1RM.

**Cele SM** to osobne zakresy ciężaru na 6 powtórzeń pod koniec fazy, wyliczane z masy ciała. Nie ustawiają ciężaru pierwszego treningu ani indywidualnego celu na jednej z granic zakresu. Podano tylko dostarczone mnożniki przysiadu oraz wiosłowań; brak mnożników wypychania nogami i stepu jest widoczny jako brak danych.

**US** wymaga wybrania w planie 2 albo 3 serii. Pierwsza ma 60%, ostatnia 80% 1RM. Przy trzech seriach środkowa nie ma źródłowego zalecenia: jej ciężar można wpisać jako ustawienie własne w planie lub ręcznie podczas treningu. Nie dodano domyślnych 70%. Zalecenie na ekranie treningu zmienia się zgodnie z numerem serii.

W szczegółach ćwiczenia znajduje się **kalkulator szacowanego 1RM** z tabeli 13.7, dla 4–10 powtórzeń wykonanych do granicy możliwości. Wyświetlenie wyniku niczego nie zapisuje; dopiero osobny przycisk zapisuje pomiar oznaczony jako szacowany. Zapis zwykłej serii nadal nie aktualizuje 1RM.

`python manage.py seed_demo` dodaje wyraźnie oznaczony profil, fazę, ćwiczenia, pomiary i plan DEMO. Polecenie można uruchamiać ponownie bez tworzenia kolejnych kopii tego samego zestawu. Parametry służą wyłącznie sprawdzeniu aplikacji i **nie są zaleceniami Joe Friela ani gotową receptą treningową**.

Do pełnego odwzorowania pozostają kompletna tabela celów SM 13.3 oraz brakujący przypis AA ze strony 236. Nie odtworzono ich z domysłów. Dla ćwiczeń tułowia z nieustalonym sposobem obciążania aplikacja pokazuje brak danych zamiast podstawiać masę ciała jako 1RM. Administrator może zarządzać fazami, pozycjami, wariantami i celami w panelu Django.

### Aktualizacja istniejącej instalacji

Zachowaj kopię `db.sqlite3`, zatrzymaj serwer i wykonaj w aktywnym venv:

```powershell
git pull origin main
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Nowe definicje zostają dodane przez migracje. Dotychczasowe plany, pomiary i kopie rozpoczętych oraz zakończonych treningów pozostają zachowane. Istniejące plany nie są automatycznie zastępowane nowymi zaleceniami; utwórz plan z wybraną fazą, aby skorzystać z nowej bazy.

Jeżeli po aktualizacji brakuje definicji faz lub ich ćwiczeń, polecenie `python manage.py seed_friel` uzupełnia brakujące dane źródłowe, zachowując istniejące wpisy. DEMO jest oddzielnym zestawem i nie zastępuje ćwiczeń Friela.

## Telefon, HTTPS i PWA

Do prostego sprawdzenia interfejsu w tej samej sieci Wi-Fi dodaj adres komputera do `DJANGO_ALLOWED_HOSTS` i uruchom:

```powershell
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1,192.168.1.20"
python manage.py runserver 0.0.0.0:8000
```

Zastąp adres rzeczywistym adresem komputera; może być potrzebna reguła zapory Windows dla prywatnej sieci. Telefon otworzy wtedy `http://192.168.1.20:8000/`. To sprawdza dostęp i responsywność, ale **nie daje pełnej obsługi PWA/offline**: przeglądarki wymagają bezpiecznego kontekstu HTTPS dla service workera poza wyjątkiem localhost.

Do rzeczywistej pracy PWA na telefonie użyj zaufanego HTTPS, np. reverse proxy z ważnym certyfikatem przed serwerem aplikacji. Certyfikat musi być zaufany również na telefonie. Ustaw rzeczywistą domenę i pochodzenie:

```powershell
$env:DJANGO_DEBUG = "0"
$env:DJANGO_ALLOWED_HOSTS = "trening.twoja-domena.pl"
$env:DJANGO_CSRF_TRUSTED_ORIGINS = "https://trening.twoja-domena.pl"
```

Wykonaj `python manage.py collectstatic --noinput`, skonfiguruj serwowanie `/static/` i użyj serwera WSGI za reverse proxy. `runserver` jest serwerem developerskim. Ponieważ profile nie mają logowania, aplikację udostępniaj tylko w zaufanej sieci lub dodaj kontrolę dostępu na reverse proxy. Samo HTTPS nie dodaje uwierzytelniania profili.

Przy otwartej aplikacji online przeglądarka rejestruje service worker, pobiera zasoby i manifest. Użyj opcji pobrania/przygotowania planu offline i poczekaj na potwierdzenie. Następnie można dodać aplikację do ekranu głównego w menu przeglądarki. Przed odłączeniem sieci otwórz przygotowaną sesję; wskaźnik powinien pokazywać zapis lokalny i stan połączenia.

Offline działa dla **wcześniej przygotowanego treningu**, a nie całego panelu administracyjnego czy wszystkich formularzy. Serie, ich edycje i usunięcia, pozycja ćwiczenia oraz zakończenie sesji trafiają do IndexedDB wraz z kolejką operacji. UUID operacji i serii pozwalają ponawiać synchronizację bez duplikatów. Kolejka jest usuwana dopiero po potwierdzeniu serwera. Po odzyskaniu połączenia otwórz aplikację i poczekaj, aż licznik oczekujących zmian spadnie do zera.

Nie czyść danych witryny, nie używaj trybu prywatnego i nie odinstalowuj aplikacji, dopóki istnieją niesynchronizowane zmiany. IndexedDB jest danymi konkretnej przeglądarki/urządzenia; system może usunąć magazyn witryny. Pierwsza wersja obsługuje jedną lokalną kolejkę na urządzeniu. Nie rozwiązuje równoczesnych edycji tej samej sesji na kilku urządzeniach.

Synchronizacja na serwerze jest ograniczona do aktywnego profilu. Przed zmianą osoby poczekaj na przesłanie jej zmian. Jeśli zmienisz profil z oczekującą kolejką, dane pozostaną lokalnie, lecz inny profil nie może ich wysłać. Wybierz ponownie profil właściciela treningu, otwórz jego sesję online i poczekaj na potwierdzenie synchronizacji.

## Testy

Wykonane sprawdzenia i ich ograniczenia opisuje [raport weryfikacji](docs/WERYFIKACJA.md).

```powershell
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test
```

Testy obejmują reguły obliczeń, zakresy, brak danych, kopie historyczne, kolejność i numerację, rozdzielenie profili, zakończenie sesji i ponowione operacje. Testy serwera nie zastępują kontroli przeglądarki. Ręczny scenariusz dla telefonu i komputera:

1. Otwórz DEMO, rozpocznij trening i sprawdź nazwę pierwszego ćwiczenia.
2. Zmień ciężar przyciskami `±1`, `±5`, `±10` oraz liczbę powtórzeń. Sprawdź ręczną edycję i brak ujemnych wartości.
3. Dodaj kilka serii, popraw jedną i usuń inną. Przejdź do następnego i poprzedniego ćwiczenia; sprawdź nazwę, zalecenia i listę serii.
4. Odśwież i zamknij/otwórz aplikację. Wznów sesję.
5. Przygotuj sesję online, wyłącz sieć, dodaj serie i odśwież. Zakończ offline, przywróć sieć i sprawdź synchronizację bez powielonych serii.
6. Otwórz zakończoną sesję: ma podsumowanie i nie ma formularza dodawania serii.

### Opcjonalne testy przeglądarki

Skrypty Playwright wymagają dodatkowo Node.js i npm. Nie są zależnościami samej aplikacji. Instalacja w PowerShell:

```powershell
npm install
npx playwright install chromium
```

W pierwszym terminalu, z aktywnym venv, przygotuj DEMO i uruchom serwer:

```powershell
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 127.0.0.1:8000 --noreload
```

W drugim terminalu w katalogu projektu uruchom:

```powershell
npm run test:browser
node scripts/browser_sync_edges.cjs
node scripts/browser_friel.cjs
node scripts/browser_phase_templates.cjs
```

Skrypty sprawdzają aplikację w Chromium, w tym warianty rozmiaru ekranu i zachowanie kolejki offline. Test `test:browser` tworzy nowe sesje treningowe w danych DEMO i zapisuje w nich serie. Testy `browser_sync_edges.cjs` i `browser_friel.cjs` tworzą oddzielne profile QA i usuwają je po zakończeniu. Pierwszy sprawdza utratę potwierdzenia oraz edycję podczas synchronizacji; drugi zalecenia kolejnych serii US, brak automatycznego ciężaru z celu SM i zachowanie parametrów AA. Używaj developerskiej bazy, a nie jedynej kopii własnych wyników. Wyniki konkretnego uruchomienia podaje raport weryfikacji.

## Eksport i kopie bezpieczeństwa

W **Ustawieniach** dostępny jest JSON danych aktywnego profilu i CSV wyników treningowych. Eksport pochodzi z serwera; przed jego wykonaniem zsynchronizuj kolejkę lokalną. Plik JSON jest eksportem danych do odczytu/przeniesienia we własnych narzędziach; w tej wersji aplikacja nie ma importera JSON.

Pełną kopię aplikacji wykonuj przy zatrzymanym serwerze: zachowaj `db.sqlite3` i pliki projektu, a konfigurację/sekrety przechowuj osobno. Kopia SQLite obejmuje również konta administratorów i definicje faz, których sam eksport profilu nie zastępuje. Plik bazy i eksporty zawierają prywatne dane — nie dodawaj ich do repozytorium.

Zakres celowo nie obejmuje kont internetowych, funkcji społecznościowych, płatności, integracji kolarskich ani generatora planów AI.
