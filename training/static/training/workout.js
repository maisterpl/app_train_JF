/* IndexedDB is the durable source for a prepared workout and its outbox.
 * An operation and its optimistic result are always committed together. */
const DATABASE = 'sila-kolarza-v1';
let databasePromise;
let localSerial = Promise.resolve();
const syncJobs = new Map();
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
function exerciseProgressLink(exercise) {
  const id = Number(exercise.snapshot?.exercise_id);
  return Number.isSafeInteger(id) && id > 0
    ? `<p><a class="button button-secondary" href="/exercises/${id}/#progress-chart">Historia i wykres tego ćwiczenia →</a></p>` : '';
}
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Basic online use over a private LAN still works without randomUUID(),
  // which browsers expose only in secure contexts. PWA itself still needs HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('workouts', {keyPath: 'id'});
      const operations = db.createObjectStore('operations', {keyPath: 'id'});
      operations.createIndex('workout_id', 'workout_id');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Nie zapisano danych lokalnie.'));
    tx.onerror = () => reject(tx.error);
  });
}

function changed(id, source = 'local') {
  window.dispatchEvent(new CustomEvent('workout-local-change', {detail: {id, source}}));
}

export async function getWorkout(id) {
  const db = await database();
  return requestValue(db.transaction('workouts').objectStore('workouts').get(id));
}

export async function pendingOperations(id) {
  const db = await database();
  const store = db.transaction('operations').objectStore('operations');
  const rows = await requestValue(id ? store.index('workout_id').getAll(id) : store.getAll());
  return rows.sort((a, b) => a.sequence - b.sequence);
}

export async function allWorkouts() {
  const db = await database();
  return requestValue(db.transaction('workouts').objectStore('workouts').getAll());
}

function applyOperation(workout, operation) {
  if (operation.type === 'finish') {
    workout.status = 'completed';
    workout.finished_at = operation.finished_at || new Date().toISOString();
    workout.restDeadline = null;
    return;
  }
  if (operation.type === 'navigate') {
    workout.current_position = operation.position;
    return;
  }
  const exercise = workout.exercises.find(ex => ex.id === operation.exercise_id);
  if (!exercise) throw new Error('Nie znaleziono ćwiczenia w tym treningu.');
  if (operation.type === 'skip') exercise.skipped = operation.skipped;
  if (operation.type === 'set.upsert') {
    const index = exercise.sets.findIndex(set => set.id === operation.set.id);
    if (index < 0) exercise.sets.push({...operation.set, number: exercise.sets.length + 1});
    else exercise.sets[index] = {...operation.set, number: exercise.sets[index].number};
    exercise.skipped = false;
  }
  if (operation.type === 'set.delete') exercise.sets = exercise.sets.filter(set => set.id !== operation.set_id);
  exercise.sets.forEach((set, index) => { set.number = index + 1; });
}

// Only overwrite a cached workout after rebasing its unacknowledged operations.
export async function cacheWorkout(serverWorkout, acknowledged = []) {
  const db = await database();
  const tx = db.transaction(['workouts', 'operations'], 'readwrite');
  const done = transactionDone(tx);
  const workouts = tx.objectStore('workouts');
  const operations = tx.objectStore('operations');
  const [old, outstanding] = await Promise.all([
    requestValue(workouts.get(serverWorkout.id)),
    requestValue(operations.index('workout_id').getAll(serverWorkout.id)),
  ]);
  const acknowledgedSet = new Set(acknowledged);
  const next = clone(serverWorkout);
  next.localSequence = old?.localSequence || 0;
  next.restDeadline = old?.restDeadline || null;
  outstanding.sort((a, b) => a.sequence - b.sequence).forEach(row => {
    if (acknowledgedSet.has(row.id)) operations.delete(row.id);
    else applyOperation(next, row.operation);
  });
  if (next.status === 'completed') next.restDeadline = null;
  workouts.put(next);
  await done;
  changed(next.id, 'server');
  return next;
}

export function queueOperation(workoutId, operation, extra = {}) {
  const task = localSerial.catch(() => {}).then(async () => {
    const db = await database();
    const tx = db.transaction(['workouts', 'operations'], 'readwrite');
    const done = transactionDone(tx);
    const workouts = tx.objectStore('workouts');
    const workout = await requestValue(workouts.get(workoutId));
    if (!workout) { tx.abort(); await done.catch(() => {}); throw new Error('Najpierw pobierz trening do pracy offline.'); }
    if (workout.status !== 'active') { tx.abort(); await done.catch(() => {}); throw new Error('Ten trening jest już zakończony.'); }
    const payload = {...operation, id: operation.id || uuid()};
    applyOperation(workout, payload);
    Object.assign(workout, extra);
    workout.localSequence = (workout.localSequence || 0) + 1;
    tx.objectStore('operations').add({id: payload.id, workout_id: workoutId, sequence: workout.localSequence, operation: payload});
    workouts.put(workout);
    await done;
    changed(workoutId);
    return workout;
  });
  localSerial = task;
  return task;
}

export async function csrfToken() {
  const response = await fetch('/api/csrf/', {credentials: 'same-origin', cache: 'no-store'});
  if (!response.ok) throw new Error('Nie udało się odświeżyć zabezpieczenia CSRF.');
  return (await response.json()).csrfToken;
}

export async function jsonRequest(url, body) {
  const token = await csrfToken();
  const response = await fetch(url, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {'Content-Type': 'application/json', 'X-CSRFToken': token},
    body: JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Serwer zwrócił błąd ${response.status}. Zmiany pozostają na urządzeniu.`); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data.errors || 'Błąd zapisu na serwerze.'));
  return data;
}

export function syncWorkout(id) {
  if (syncJobs.has(id)) return syncJobs.get(id);
  const execute = async () => {
    if (!navigator.onLine) return;
    // A batch is a snapshot. New operations stay in IndexedDB and are replayed
    // over the server response instead of being lost during an in-flight POST.
    let rows = (await pendingOperations(id)).slice(0, 100);
    while (rows.length && navigator.onLine) {
      const data = await jsonRequest(`/api/workouts/${id}/sync/`, {operations: rows.map(row => row.operation)});
      if (!data.workout || !Array.isArray(data.acknowledged)) throw new Error('Niepełne potwierdzenie serwera. Zachowano zmiany lokalne.');
      const sent = new Set(rows.map(row => row.id));
      const accepted = data.acknowledged.filter(op => sent.has(op));
      if (!accepted.length) throw new Error('Serwer nie potwierdził zmian. Zachowano je lokalnie.');
      await cacheWorkout(data.workout, accepted);
      rows = (await pendingOperations(id)).slice(0, 100);
    }
  };
  const job = (navigator.locks ? navigator.locks.request(`workout-sync-${id}`, execute) : execute())
    .then(() => { window.dispatchEvent(new CustomEvent('workout-sync-success', {detail: {id}})); })
    .catch(error => {
      window.dispatchEvent(new CustomEvent('workout-sync-error', {detail: {id, message: error.message}}));
      throw error;
    }).finally(() => syncJobs.delete(id));
  syncJobs.set(id, job);
  return job;
}

export async function syncAll() {
  const ids = [...new Set((await pendingOperations()).map(row => row.workout_id))];
  return Promise.allSettled(ids.map(id => syncWorkout(id)));
}

function range(min, max, unit = '') {
  if (min == null && max == null) return 'Brak danych';
  const value = min ?? max;
  return `${value}${max != null && String(max) !== String(value) ? `–${max}` : ''}${unit}`;
}

function repetitionLabel(snapshot) {
  const source = snapshot.reps_original || '';
  const bounds = source.match(/\d+/g)?.map(Number) || [];
  const same = bounds.length && Number(snapshot.reps_min) === bounds[0] &&
    Number(snapshot.reps_max ?? snapshot.reps_min) === bounds[bounds.length - 1];
  return same ? source : range(snapshot.reps_min, snapshot.reps_max);
}

function resultLabel(set, mode) {
  return mode === 'time' ? `${set.seconds ?? '—'} s` : `${set.weight ?? '—'} kg × ${set.reps ?? '—'} powt.`;
}

function duration(start, end) {
  const seconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

class WorkoutApp {
  constructor(root) {
    this.root = root;
    this.drafts = new Map();
    this.busy = false;
    this.localCommitDepth = 0;
    this.deferredRender = false;
    this.pointerDown = false;
    this.error = '';
    this.id = root.dataset.workoutId || location.pathname.match(/\/workouts\/([0-9a-f-]{36})\//i)?.[1] || localStorage.getItem('last-workout-id');
    this.root.addEventListener('click', event => this.click(event));
    this.root.addEventListener('submit', event => this.submit(event));
    this.root.addEventListener('input', event => this.input(event));
    this.root.addEventListener('focusout', () => this.flushDeferredRender());
    window.addEventListener('pointerdown', () => { this.pointerDown = true; }, {capture: true});
    window.addEventListener('pointerup', () => { this.pointerDown = false; this.flushDeferredRender(); });
    window.addEventListener('pointercancel', () => { this.pointerDown = false; this.flushDeferredRender(); });
    window.addEventListener('workout-local-change', event => {
      if (event.detail.id !== this.id) return;
      // commit() already has the exact committed result; avoid a second delayed
      // local refresh that could recreate the next exercise's form while typing.
      if (event.detail.source === 'local' && this.localCommitDepth) return;
      this.refresh(event.detail.source === 'local');
    });
    window.addEventListener('workout-sync-error', event => {
      if (event.detail.id === this.id) this.message(`Zmiany są bezpieczne na urządzeniu. ${event.detail.message}`);
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  async init() {
    try {
      if (!this.id) throw new Error('Otwórz wcześniej pobrany trening, korzystając z jego adresu. Przygotowanie nowego treningu wymaga połączenia.');
      const initial = document.getElementById('initial_workout') || document.getElementById('initial-workout');
      if (initial) {
        try { await cacheWorkout(JSON.parse(initial.textContent)); } catch (error) { console.warn('Initial workout cache', error); }
      }
      await this.refresh(true);
      if (navigator.onLine) {
        await syncWorkout(this.id).catch(() => {});
        const response = await fetch(`/api/workouts/${this.id}/`, {cache: 'no-store', credentials: 'same-origin'});
        if (response.ok) {
          const data = await response.json();
          await cacheWorkout(data.workout || data);
          await this.refresh();
        }
      }
      if (!this.workout) throw new Error('Ten trening nie jest zapisany na tym urządzeniu. Otwórz go najpierw online i pobierz do pracy offline.');
      localStorage.setItem('last-workout-id', this.id);
    } catch (error) {
      if (this.workout) this.message(`Tryb lokalny: ${error.message}`);
      else this.root.innerHTML = `<div class="card"><h1>Trening offline</h1><p role="alert">${escapeHTML(error.message)}</p><a class="button" href="/">Wróć do Start</a></div>`;
    }
  }

  async refresh(force = false) {
    this.workout = await getWorkout(this.id);
    if (this.workout) this.render(true, force);
  }

  flushDeferredRender() {
    clearTimeout(this.deferredTimer);
    this.deferredTimer = setTimeout(() => {
      if (!this.deferredRender || this.pointerDown) return;
      const form = this.root.querySelector('#set-form');
      if (form?.contains(document.activeElement)) return;
      this.deferredRender = false;
      this.refresh(true);
    }, 0);
  }

  current() {
    const index = Math.max(0, Math.min(this.workout.exercises.length - 1, Number(this.workout.current_position) || 0));
    return this.workout.exercises[index];
  }

  draft() {
    const exercise = this.current();
    if (!this.drafts.has(exercise.id)) {
      this.drafts.set(exercise.id, this.newDraft(exercise));
    }
    return this.drafts.get(exercise.id);
  }

  seriesNumber(exercise, draft = this.drafts.get(exercise.id)) {
    const editing = draft?.id && exercise.sets.find(set => set.id === draft.id);
    return editing ? editing.number : exercise.sets.length + 1;
  }

  seriesLoad(exercise, draft = this.drafts.get(exercise.id)) {
    const snapshot = exercise.snapshot;
    if (snapshot.series_load_mode !== 'endpoints') return snapshot.load || {};
    const loads = snapshot.load?.series_loads || snapshot.series_loads || [];
    const number = this.seriesNumber(exercise, draft);
    return loads[number - 1] || {
      min: null, max: null,
      explanation: 'Brak danych dla dodatkowej serii. Wpisz ciężar jako ustawienie własne.',
      missing: 'Liczba serii przekracza liczbę wybraną w planie.', custom: true,
    };
  }

  newDraft(exercise, previous = null) {
    const snapshot = exercise.snapshot;
    // US prescribes first and last sets individually. A completed set must not
    // carry its weight into the next set, especially into the unknown middle set.
    const prescribed = this.seriesLoad(exercise, {id: null});
    const weight = snapshot.series_load_mode === 'endpoints'
      ? (prescribed.min ?? '')
      : (previous?.weight ?? prescribed.min ?? (snapshot.basis === 'none' ? '0' : ''));
    return {id: null, weight, reps: previous?.reps ?? snapshot.reps_min ?? '', seconds: previous?.seconds ?? snapshot.seconds ?? '', note: ''};
  }

  message(message) {
    this.error = message;
    const box = this.root.querySelector('#workout-message');
    if (box) { box.textContent = message; box.hidden = !message; }
  }

  captureDraft() {
    const form = this.root.querySelector('#set-form');
    if (!form) return;
    const draft = this.drafts.get(form.dataset.exerciseId);
    if (!draft) return;
    for (const field of ['weight', 'reps', 'seconds', 'note']) {
      const input = form.elements.namedItem(field);
      if (input) draft[field] = input.value;
    }
  }

  render(preserveDraft = true, force = false) {
    const liveForm = this.root.querySelector('#set-form');
    if (!force && preserveDraft && this.workout.status === 'active' &&
        liveForm?.dataset.exerciseId === this.current()?.id && liveForm.contains(document.activeElement)) {
      // Keep the actual input nodes alive while typing. Recreating them between
      // focus/select-all and insertion can corrupt numeric input (e.g. 35→3530).
      // Server changes are rendered once focus leaves; a deliberate local action
      // such as save/navigation always forces its own immediate update.
      this.deferredRender = true;
      return;
    }
    this.deferredRender = false;
    // A sync acknowledgement can arrive while the user is typing. Preserve
    // the live form as well as its focused field before updating the set list.
    // (An input event may still be waiting in the browser's event queue.)
    if (preserveDraft) this.captureDraft();
    const focused = this.root.contains(document.activeElement) ? document.activeElement : null;
    const focusedName = focused?.name;
    const focusedExercise = focused?.closest('form')?.dataset.exerciseId;
    let selection;
    try { selection = [focused?.selectionStart, focused?.selectionEnd]; } catch { selection = null; }
    const workout = this.workout;
    if (workout.status === 'completed') { this.renderSummary(); return; }
    const exercise = this.current();
    if (!exercise) { this.root.innerHTML = '<div class="card"><h1>Plan nie ma ćwiczeń</h1><a href="/plans/">Wróć do planów</a></div>'; return; }
    const s = exercise.snapshot;
    const d = this.draft();
    const index = workout.exercises.indexOf(exercise);
    const isTime = s.mode === 'time';
    const previous = s.previous_results || [];
    const load = this.seriesLoad(exercise, d);
    const seriesNumber = this.seriesNumber(exercise, d);
    const bySeries = s.series_load_mode === 'endpoints';
    const seriesLoads = s.load?.series_loads || s.series_loads || [];
    const endGoal = s.end_goal;
    const repetitions = repetitionLabel(s);
    this.root.innerHTML = `
      <div class="workout-heading"><div><p class="eyebrow">${escapeHTML(workout.plan_name)} · ${escapeHTML(workout.phase_name)}</p><p>Profil: ${escapeHTML(workout.profile_name || `#${workout.profile_id}`)} · Ćwiczenie ${index + 1} z ${workout.exercises.length}</p><h1>${escapeHTML(s.name)}</h1>${s.parameter_code ? `<p class="parameter-origin">Zestaw parametrów tego ćwiczenia: <strong>${escapeHTML(s.parameter_code)}</strong></p>` : ''}</div><span class="badge">${exercise.skipped ? 'Pominięte' : 'W trakcie'}</span></div>
      <div id="workout-message" class="notice" role="status" ${this.error ? '' : 'hidden'}>${escapeHTML(this.error)}</div>
      <div class="workout-grid"><section class="card">
        <div class="workout-targets"><div><span>Serie</span><strong>${escapeHTML(bySeries ? `${s.chosen_sets ?? 'Brak danych'} wybrane (${range(s.sets_min, s.sets_max)})` : range(s.sets_min, s.sets_max))}</strong></div><div><span>${isTime ? 'Czas' : 'Powtórzenia'}</span><strong>${escapeHTML(isTime ? range(s.seconds, null, ' s') : repetitions)}</strong></div><div><span>${bySeries ? `Obciążenie serii ${seriesNumber}` : 'Obciążenie'}</span><strong>${escapeHTML(s.basis === 'none' ? 'Bez obciążenia' : range(load.min, load.max, ' kg'))}</strong></div></div>
        <p>${escapeHTML(load.explanation || 'Brak danych o obciążeniu')}</p>
        ${s.reps_original && repetitions !== s.reps_original ? `<p class="muted small">Powtórzenia według źródła: ${escapeHTML(s.reps_original)}. Powyżej pokazano własne parametry planu.</p>` : ''}
        ${bySeries ? `<section class="series-prescriptions"><h2>Obciążenie każdej serii</h2><ol>${seriesLoads.map((series, number) => `<li${number + 1 === seriesNumber ? ' aria-current="step"' : ''}><strong>Seria ${number + 1}:</strong> ${escapeHTML(series.explanation || series.missing || 'Brak danych')}${series.is_custom || series.custom ? ' · Ustawienie własne' : ''}</li>`).join('')}</ol><p class="muted small">Dla trzech serii źródło określa tylko pierwszą (60%) i ostatnią (80%). Środkowy ciężar wymaga ustawienia własnego.</p></section>` : ''}
        ${endGoal ? `<section class="end-goal notice"><h2>Cel końcowy na ${escapeHTML(endGoal.target_reps || 6)} powtórzeń</h2><p>${escapeHTML(endGoal.explanation || endGoal.missing || 'Brak danych')}</p><p>To zakres celu pod koniec fazy SM. Nie jest ciężarem pierwszego treningu ani automatycznie wybranym celem konkretnej osoby.</p>${endGoal.missing ? `<p>${escapeHTML(endGoal.missing)}</p>` : ''}</section>` : ''}
        ${load.missing ? `<p class="notice">${escapeHTML(Array.isArray(load.missing) ? load.missing.join('; ') : load.missing)} ${bySeries ? 'Możesz wpisać ciężar tej serii ręcznie jako ustawienie własne.' : '<a href="/profiles/">Uzupełnij profil i masę</a> · <a href="/exercises/">Wartości 1RM</a>'}</p>` : ''}
        <p><b>Tempo:</b> ${escapeHTML(s.tempo || 'Brak danych')} · <b>Odpoczynek:</b> ${escapeHTML(range(s.rest_seconds, s.rest_seconds_max, ' s'))}</p>
        <details><summary>Technika i uwagi</summary><p>${escapeHTML(s.description || 'Brak danych')}</p><p>${escapeHTML(s.notes || '')}</p><p>Zapis ciężaru: ${escapeHTML(s.load_notation || 'Brak danych')}</p></details>
        <h2>${d.id ? `Edytuj serię ${seriesNumber}` : `Zapisz serię ${seriesNumber}`}</h2>
        <form id="set-form" data-exercise-id="${exercise.id}" novalidate>
          <label for="set-weight">Ciężar (kg)</label><input id="set-weight" name="weight" class="workout-value" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHTML(d.weight)}" required>
          <div class="weight-controls" aria-label="Zmiana ciężaru">${[-10,-5,-1,1,5,10].map(value => `<button class="button button-secondary" type="button" data-action="adjust" data-field="weight" data-delta="${value}">${value > 0 ? '+' : '−'}${Math.abs(value)}</button>`).join('')}</div>
          <label for="set-amount">${isTime ? 'Czas (sekundy)' : 'Powtórzenia'}</label><div class="amount-controls"><button type="button" class="button button-secondary" data-action="adjust" data-field="${isTime ? 'seconds' : 'reps'}" data-delta="-${isTime ? 5 : 1}" aria-label="Zmniejsz ${isTime ? 'czas' : 'powtórzenia'}">−</button><input id="set-amount" name="${isTime ? 'seconds' : 'reps'}" class="workout-value" type="number" min="0" step="1" inputmode="numeric" value="${escapeHTML(isTime ? d.seconds : d.reps)}" required><button type="button" class="button button-secondary" data-action="adjust" data-field="${isTime ? 'seconds' : 'reps'}" data-delta="${isTime ? 5 : 1}" aria-label="Zwiększ ${isTime ? 'czas' : 'powtórzenia'}">+</button></div>
          <label for="set-note">Notatka (opcjonalnie)</label><input id="set-note" name="note" maxlength="500" value="${escapeHTML(d.note)}" placeholder="Np. odczucie wysiłku, technika">
          <div class="actions"><button type="submit" class="button" ${this.busy ? 'disabled' : ''}>${d.id ? 'Zapisz poprawkę' : 'Zapisz serię'}</button>${d.id ? '<button type="button" class="button button-secondary" data-action="cancel-edit">Anuluj edycję</button>' : ''}</div>
        </form>
      </section><aside>
        <section class="card rest-card"><p class="eyebrow">Odpoczynek</p><div id="rest-timer" class="workout-value" aria-live="off">—</div><button type="button" class="button button-secondary" data-action="stop-timer">Zakończ odpoczynek</button></section>
        <section class="card"><h2>Serie w tej sesji</h2>${exercise.sets.length ? `<ol class="set-list">${exercise.sets.map(set => `<li><div><strong>Seria ${set.number}: ${escapeHTML(resultLabel(set, s.mode))}</strong>${set.note ? `<p>${escapeHTML(set.note)}</p>` : ''}</div><div class="actions"><button type="button" class="button button-secondary" data-action="edit-set" data-id="${set.id}">Edytuj</button><button type="button" class="button button-danger" data-action="delete-set" data-id="${set.id}">Usuń</button></div></li>`).join('')}</ol>` : '<p>Nie zapisano jeszcze serii.</p>'}</section>
        <section class="card"><h2>Ostatnie wyniki</h2>${previous.length ? `<ul>${previous.map(set => `<li>${escapeHTML(set.date ? new Date(set.date).toLocaleDateString('pl-PL') : '')}: ${escapeHTML(resultLabel(set, s.mode))}</li>`).join('')}</ul>` : '<p>To ćwiczenie nie ma jeszcze zapisanej historii</p>'}</section>
      </aside></div>
      <div class="card workout-navigation actions"><button type="button" class="button button-secondary" data-action="previous" ${index === 0 ? 'disabled' : ''}>← Poprzednie ćwiczenie</button><button type="button" class="button button-secondary" data-action="skip">${exercise.skipped ? 'Przywróć ćwiczenie' : 'Pomiń ćwiczenie'}</button><button type="button" class="button" data-action="next" ${index >= workout.exercises.length - 1 ? 'disabled' : ''}>Następne ćwiczenie →</button><button type="button" class="button button-danger" data-action="finish">Zakończ trening</button></div>
    `;
    if (focusedName && focusedExercise === exercise.id) {
      const replacement = this.root.querySelector(`[name="${focusedName}"]`);
      replacement?.focus({preventScroll: true});
      if (selection?.[0] != null) {
        try { replacement?.setSelectionRange(selection[0], selection[1]); } catch { /* Number inputs have no text selection API. */ }
      }
    }
    this.tick();
  }

  renderSummary() {
    const workout = this.workout;
    this.root.innerHTML = `<div class="card"><p class="eyebrow">Trening zakończony</p><h1>${escapeHTML(workout.plan_name)}</h1><p>Profil: ${escapeHTML(workout.profile_name || `#${workout.profile_id}`)}</p><p>${escapeHTML(workout.phase_name)} · ${escapeHTML(duration(workout.started_at, workout.finished_at))}</p><p>Wyniki zapisane. Oczekujące zmiany zostaną wysłane po odzyskaniu połączenia.</p><div id="workout-message" class="notice" role="status" ${this.error ? '' : 'hidden'}>${escapeHTML(this.error)}</div></div>${workout.exercises.map(ex => `<section class="card"><h2>${escapeHTML(ex.snapshot.name)}</h2>${exerciseProgressLink(ex)}${ex.skipped ? '<p>Pominięte</p>' : ''}${ex.sets.length ? `<ol>${ex.sets.map(set => `<li>Seria ${set.number}: <strong>${escapeHTML(resultLabel(set, ex.snapshot.mode))}</strong>${set.note ? ` — ${escapeHTML(set.note)}` : ''}</li>`).join('')}</ol>` : '<p>Brak wykonanych serii</p>'}</section>`).join('')}<div class="actions"><a class="button" href="/workouts/">Historia treningów</a><a class="button button-secondary" href="/">Wróć do Start</a></div>`;
  }

  input(event) {
    if (!this.workout || this.workout.status !== 'active' || !event.target.name) return;
    this.draft()[event.target.name] = event.target.value;
  }

  async commit(operation, extra = {}) {
    this.localCommitDepth++;
    try {
      this.workout = await queueOperation(this.id, operation, extra);
      this.error = '';
      this.render(true, true);
    } finally { this.localCommitDepth--; }
    syncWorkout(this.id).catch(() => {});
  }

  async submit(event) {
    if (event.target.id !== 'set-form') return;
    event.preventDefault();
    if (this.busy || this.workout.status !== 'active') return;
    this.captureDraft();
    const d = this.draft();
    const isTime = this.current().snapshot.mode === 'time';
    const weight = Number(String(d.weight).replace(',', '.'));
    const amount = Number(isTime ? d.seconds : d.reps);
    const rawAmount = isTime ? d.seconds : d.reps;
    if (d.weight === '' || !Number.isFinite(weight) || weight < 0 || weight > 99999 || rawAmount === '' || !Number.isInteger(amount) || amount < 0 || amount > 1000000) {
      this.message('Podaj nieujemny ciężar oraz całkowitą liczbę powtórzeń lub sekund. Ciężar maks. 99 999 kg.');
      return;
    }
    const exercise = this.current();
    const seconds = Number(exercise.snapshot.rest_seconds || 0);
    const set = {id: d.id || uuid(), weight: weight.toFixed(2), reps: isTime ? null : amount, seconds: isTime ? amount : null, note: d.note || ''};
    const submittedAt = performance.now();
    this.busy = true;
    try {
      await this.commit({type: 'set.upsert', exercise_id: exercise.id, set}, {restDeadline: seconds ? Date.now() + seconds * 1000 : null});
      const updatedExercise = this.workout.exercises.find(row => row.id === exercise.id);
      this.drafts.set(exercise.id, this.newDraft(updatedExercise, d));
      this.render(false);
    } catch (error) { this.message(error.message); }
    finally {
      // A fast IndexedDB commit can finish between the two clicks of a double
      // tap. Keep a short guard so that the second click cannot create a new UUID.
      const remaining = 450 - (performance.now() - submittedAt);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      this.busy = false;
      this.root.querySelector('[type="submit"]')?.removeAttribute('disabled');
    }
  }

  async click(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled || !this.workout || this.workout.status !== 'active') return;
    const action = button.dataset.action;
    const exercise = this.current();
    const index = this.workout.exercises.indexOf(exercise);
    try {
      if (action === 'adjust') {
        const field = button.dataset.field;
        const d = this.draft();
        const value = Math.max(0, Math.round(((Number(String(d[field]).replace(',', '.')) || 0) + Number(button.dataset.delta)) * 100) / 100);
        d[field] = value;
        this.root.querySelector(`[name="${field}"]`).value = value;
        return;
      }
      if (action === 'edit-set') {
        this.drafts.set(exercise.id, {...exercise.sets.find(set => set.id === button.dataset.id)});
        this.render(false);
        this.root.querySelector('#set-weight').focus();
      }
      if (action === 'cancel-edit') { this.drafts.delete(exercise.id); this.render(false); }
      if (action === 'delete-set') await this.commit({type: 'set.delete', exercise_id: exercise.id, set_id: button.dataset.id});
      if (action === 'next' || action === 'previous') await this.commit({type: 'navigate', position: index + (action === 'next' ? 1 : -1)});
      if (action === 'skip') {
        await this.commit({type: 'skip', exercise_id: exercise.id, skipped: !exercise.skipped});
        if (exercise.skipped === false && index < this.workout.exercises.length - 1) await this.commit({type: 'navigate', position: index + 1});
      }
      if (action === 'finish' && window.confirm('Zakończyć trening? Po zakończeniu nie będzie można dodawać serii.')) await this.commit({type: 'finish', finished_at: new Date().toISOString()});
      if (action === 'stop-timer') {
        // The countdown is device UI state, not a server mutation.
        const db = await database();
        const tx = db.transaction('workouts', 'readwrite');
        const done = transactionDone(tx);
        const store = tx.objectStore('workouts');
        const workout = await requestValue(store.get(this.id));
        workout.restDeadline = null;
        store.put(workout);
        await done;
        await this.refresh();
      }
    } catch (error) { this.message(error.message); }
  }

  tick() {
    const target = this.root.querySelector('#rest-timer');
    if (!target || !this.workout) return;
    const remaining = Math.max(0, Math.ceil(((this.workout.restDeadline || 0) - Date.now()) / 1000));
    target.textContent = remaining ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Gotowe';
  }
}

const workoutRoot = document.getElementById('workout-app');
if (workoutRoot) new WorkoutApp(workoutRoot).init();
