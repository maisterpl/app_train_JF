# Materiały do uzupełnienia programu Joe Friela

W repozytorium nie dostarczono materiałów źródłowych określających fazy i parametry treningu siłowego Joe Friela. Aplikacja zawiera strukturę danych i panel administracyjny, ale nie przypisuje autorowi własnych zaleceń. W interfejsie brakujące dane są oznaczane jako **Brak danych**.

Zestaw **DEMO** jest technicznym przykładem działania aplikacji. Nie jest programem Joe Friela. Nie należy zmieniać samej etykiety DEMO, aby przedstawiać te wartości jako zweryfikowane zalecenia.

Do uzupełnienia potrzebne są:

| Obszar | Dane wymagane ze źródła |
| --- | --- |
| Pochodzenie | Tytuł publikacji lub materiału, autor, wydanie/rok, strony lub lokalizacja tabel oraz udostępniony fragment, który można wykorzystać w projekcie. |
| Fazy | Dokładne nazwy, opis i kolejność faz; jeżeli istotne — długość i warunki stosowania. |
| Ćwiczenia | Dokładna lista ćwiczeń przypisana do każdej fazy, wariant wykonania, opis, kategoria i uwagi techniczne. |
| Serie | Liczba serii albo dolna i górna granica zakresu. |
| Powtórzenia/czas | Liczba lub zakres powtórzeń; dla ćwiczeń na czas — sekundy i informacja, czego dotyczy czas. |
| Obciążenie | Procent lub zakres procentowy wraz z jednoznaczną podstawą: 1RM konkretnego ćwiczenia albo masa ciała. Jeżeli występuje — ciężar stały lub brak obciążenia. |
| Sposób zapisu | Czy ciężar oznacza całość, jedną hantlę, obciążenie zewnętrzne czy inną jednostkę/konwencję. |
| Tempo | Dokładny zapis tempa i objaśnienie jego części. |
| Odpoczynek | Czas pomiędzy seriami i ewentualnie pomiędzy ćwiczeniami; jednostki oraz zakresy, jeśli występują. |
| Uwagi | Ograniczenia, warianty dla poziomów zaawansowania, rozgrzewka lub inne komentarze, które należą do danego zalecenia. |

Nie należy uzupełniać braków na podstawie samej nazwy fazy, ogólnych porad siłowych ani pamięci. Dla każdego zalecenia zachowaj identyfikowalne pochodzenie; jeśli danej wartości nie ma w źródle, pozostaw ją pustą i zapisz uwagę.

## Wprowadzanie do panelu Django

1. Dodaj lub popraw ćwiczenia w **Exercises / Ćwiczeniach**. Ustal, czy rejestrują powtórzenia czy czas, i opisz zapis ciężaru.
2. Utwórz fazę z dokładną nazwą; pole źródła wypełnij tytułem, wydaniem i stroną. Nie zaznaczaj DEMO dla zweryfikowanych materiałów.
3. Dodaj zalecenia łączące fazę z ćwiczeniem. Wpisz tylko potwierdzone parametry i właściwą podstawę obliczeń.
4. Sprawdź plan testowy dla obu podstaw obciążenia. Zweryfikuj etykietę podstawy, zakres i wynik dla znanych pomiarów profilu.
5. Istniejące rozpoczęte sesje zachowają swoje kopie parametrów. Zmiana zaleceń fazy nie powinna zmieniać ich historii.

Dokładnych danych medycznych ani haseł/kluczy nie trzeba umieszczać w tych materiałach.
