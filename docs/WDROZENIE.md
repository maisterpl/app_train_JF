# Konta i wdrożenie online

Kod jest przygotowany do uruchomienia, ale utworzenie publicznego serwera wymaga konta hostingowego i zatwierdzenia kosztów przez właściciela. Nie utworzono płatnej usługi ani domeny. Proponowany wariant to Render: jeden serwer aplikacji, automatyczne HTTPS i trwały dysk SQLite. Własna domena jest opcjonalna — można zacząć od przydzielonego adresu `https://nazwa-uslugi.onrender.com`.

## 1. Przygotowanie starszych danych

1. Zsynchronizuj treningi offline ze starej wersji przed aktualizacją. Stara kolejka bez konta nie jest automatycznie importowana do nowego magazynu konta.
2. Wykonaj kopię `db.sqlite3`, zachowując ją poza repozytorium.
3. Zainstaluj `requirements.txt` i wykonaj `python manage.py migrate`.
4. Utwórz administratora: `python manage.py createsuperuser`. Nie ma domyślnego hasła administratora.
5. Starsze profile pozostają nieprzypisane. Administrator widzi je w `/admin/` oraz w sekcji Profil i może ustawić pole właściciela. Polecenie `python manage.py assign_profile --profile 1 --username nazwa_konta` przypisuje nieprzypisany profil bez zmian historii. Podstaw rzeczywiste wartości.

Nowi użytkownicy nie widzą starszych nieprzypisanych profili. Zwykłe konto ma dostęp do własnych profili, planów, historii, API, eksportów i wykresów. Superadministrator może wybrać każdy profil i obejrzeć jego dane i wykresy. Uprawnienia dotyczą również bezpośrednich adresów URL, nie tylko widoczności przycisków.

## 2. Render — przygotowany wariant

Repozytorium zawiera `Dockerfile`, `deploy/start.sh` i `render.yaml`. Blueprint wskazuje **płatny plan Starter oraz płatny trwały dysk 1 GB**. Aktualny koszt sprawdź w panelu Render przed zatwierdzeniem. Sam plik konfiguracyjny nie tworzy usługi ani nie obciąża konta.

1. Utwórz konto Render, połącz GitHub z `maisterpl/app_train_JF` i wybierz New → Blueprint.
2. Wybierz wersję repozytorium zawierającą tę konfigurację. Przejrzyj plan, region i cenę przed utworzeniem.
3. Uzupełnij ustawienia poczty w bezpiecznym formularzu Render (następna sekcja). `DJANGO_SECRET_KEY` zostanie wygenerowany i zachowany przez Render — nie zmieniaj go przy każdym wdrożeniu.
4. Zatwierdź utworzenie usługi dopiero po sprawdzeniu kosztów. Zapisz przydzielony adres HTTPS. Konfiguracja odczytuje `RENDER_EXTERNAL_HOSTNAME` automatycznie.
5. W konsoli usługi wykonaj `python manage.py createsuperuser`. Do logowania w `/admin/` służy nazwa administratora i jego hasło.
6. Przy migracji istniejącej lokalnej bazy zatrzymaj usługę, przenieś jej spójną kopię do `/var/data/db.sqlite3`, ustaw właściciela pliku zgodnie z UID aplikacji 1000 i uruchom usługę ponownie. Nie zastępuj bazy podczas zapisu i nie nadpisuj danych już założonych online. Zrób kopię obu baz przed takim przeniesieniem. Bez tego kroku serwer zacznie od nowej bazy; samo wysłanie kodu do GitHuba nie przenosi treningów.
7. Sprawdź `/health/`, rejestrację, odbiór wiadomości, potwierdzenie adresu i logowanie z telefonu. Dwa zwykłe konta nie powinny widzieć swoich profili nawzajem.

Start kontenera wykonuje migracje i uruchamia Gunicorn z jednym procesem oraz czterema wątkami. WhiteNoise serwuje pliki statyczne. SQLite i pliki kopii muszą znajdować się na trwałym dysku `/var/data`; nie w katalogu kodu ani tymczasowym systemie plików. W tej wersji nie włączaj kilku instancji serwera ani niezależnych replik bazy. Pamięć limitów logowania jest wspólna dla jednego procesu; skalowanie wymaga wspólnego cache i zmiany bazy.

Automatyczne wdrożenia z GitHuba są wyłączone w blueprint. Następne wersje wdrażaj świadomie po kopii bazy i sprawdzeniu migracji. Publikacja kodu na GitHubie i uruchomienie usługi Render to osobne operacje.

## 3. Prawdziwa wysyłka e-maili

Użyj usługi z SMTP, która pozwala wysyłać wiadomości z zatwierdzonego adresu nadawcy, np. dostawcy poczty transakcyjnej lub własnej poczty obsługującej SMTP i hasła aplikacyjne. Odbiorcy mogą korzystać z dowolnej skrzynki e-mail.

Ustaw bezpiecznie na serwerze:

| Zmienna | Znaczenie |
| --- | --- |
| `EMAIL_HOST` | Host SMTP podany przez dostawcę. |
| `EMAIL_PORT` | Zwykle `587`; konfiguracja obsługuje STARTTLS. |
| `EMAIL_USE_TLS` | `true`. |
| `EMAIL_HOST_USER` | Identyfikator SMTP dostawcy. |
| `EMAIL_HOST_PASSWORD` | Sekret SMTP / hasło aplikacyjne; nigdy nie wpisuj go w czacie ani repozytorium. |
| `DEFAULT_FROM_EMAIL` | Adres nadawcy zatwierdzony u dostawcy. |

W produkcji `DJANGO_DEBUG=0`: używany jest SMTP, a brak hosta lub nadawcy blokuje start. W lokalnym DEBUG domyślny backend konsolowy drukuje linki w terminalu i **nie wysyła wiadomości**. Nie udostępniaj logów zawierających tokeny potwierdzenia lub resetu hasła.

Potwierdzenie adresu wymaga świadomego kliknięcia przycisku na stronie potwierdzenia (POST). Samo pobranie linku przez skaner poczty nie aktywuje konta. Dostępne są ponowne wysłanie potwierdzenia oraz reset hasła. Realną dostarczalność wiadomości trzeba sprawdzić po ustawieniu SMTP; lokalne testy używają pamięci testowej zamiast prawdziwych skrzynek.

## 4. Logowanie przez Google

1. W Google Cloud utwórz projekt i skonfiguruj Google Auth Platform / ekran zgody: nazwa aplikacji, adres kontaktowy i odbiorcy. Dla trybu testowego dodaj użytkowników testowych. Używane zakresy to wyłącznie `openid`, `email` i `profile`.
2. Utwórz klienta OAuth typu Web application.
3. Dodaj dokładny URI przekierowania: `https://TWOJ-ADRES/accounts/google/login/callback/`, z końcowym ukośnikiem. Dla lokalnego sprawdzenia możesz osobno dodać `http://127.0.0.1:8000/accounts/google/login/callback/`.
4. W ustawieniach serwera wpisz `GOOGLE_OAUTH_CLIENT_ID` oraz `GOOGLE_OAUTH_CLIENT_SECRET`. Sekret ustaw bezpiecznie w panelu hostingu, nie w kodzie i nie w czacie.
5. Uruchom aplikację ponownie. Przycisk „Kontynuuj z Google” pojawi się po ustawieniu obu wartości. Bez nich logowanie e-mailem nadal działa.
6. Sprawdź logowanie prawdziwym kontem w przeglądarce oraz powrót pod prawidłowy adres HTTPS. Po zmianie domeny uaktualnij callback w Google.

Aplikacja korzysta z django-allauth, sprawdzania stanu OAuth i PKCE. Nie łączy automatycznie istniejącego konta z Google wyłącznie po zgodności adresu e-mail. Istniejący użytkownik może po zalogowaniu zarządzać połączeniami pod `/accounts/3rdparty/`; Google bez zweryfikowanego adresu nadal wymaga weryfikacji. Nie sprawdzono na żywo logowania Google bez rzeczywistych danych klienta OAuth.

## 5. HTTPS, trwałość i kopie

- Produkcja: `DJANGO_DEBUG=0`, trwały losowy `DJANGO_SECRET_KEY`, poprawny host oraz `DJANGO_CSRF_TRUSTED_ORIGINS` dla własnej domeny. Renderowy adres jest dodawany automatycznie.
- `DJANGO_TRUST_PROXY=true` ustawiaj wyłącznie za zaufanym proxy nadpisującym `X-Forwarded-Proto`, bez bezpośredniego publicznego dostępu do Gunicorn. Render jest przewidzianym tutaj proxy.
- Sesje i cookies CSRF mają flagę Secure w produkcji. HTTP przekierowuje na HTTPS. HSTS dotyczy używanej domeny; nie zadeklarowano wszystkich subdomen ani preload przed wybraniem i zweryfikowaniem docelowej domeny. Kontrola `check --deploy` zgłasza z tego powodu dwa zalecenia W005/W021.
- W konsoli serwera wykonuj `python manage.py backup_database /var/data/kopia-NOWA-DATA.sqlite3`, a następnie pobierz kopię poza ten serwer. Polecenie tworzy spójną kopię działającej bazy przez SQLite backup API i nie nadpisuje istniejącego pliku. Harmonogram oraz zewnętrzny magazyn kopii należy ustawić po wyborze hostingu. Dysk trwały sam w sobie nie zastępuje kopii zapasowej.
- Przed wylogowaniem zsynchronizuj lokalną kolejkę. IndexedDB jest rozdzielone według konta; wylogowanie czyści lokalny magazyn, a zmiana konta blokuje widok danych w pozostałych kartach. Offline działa dla pobranego treningu na zaufanym urządzeniu, nie dla nowej rejestracji czy pierwszego logowania.

## 6. Weryfikacja lokalna

```powershell
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test
npm install
npx playwright install chromium
node scripts/browser_accounts.cjs
```

Skrypty przeglądarkowe wymagają działającego serwera developerskiego i bazy testowej; tworzą i usuwają własne zweryfikowane konta QA, nie wysyłając rzeczywistych e-maili. `browser_accounts.cjs` używa zwykłego formularza logowania i sprawdza również trening offline, rozdzielenie pamięci oraz widok administratora. Pozostałe skrypty korzystają z pomocnika tworzącego sesje wyłącznie dla swoich danych QA; nie ma takiego endpointu w aplikacji.
