import {cacheWorkout, pendingOperations, csrfToken, jsonRequest, syncAll, uuid, lastWorkoutKey, clearCurrentOfflineData} from './workout.js';

let syncError = '';
async function refreshStatus() {
  const connection = document.getElementById('connection-status');
  const counter = document.getElementById('pending-count');
  if (document.body.hasAttribute('data-account-id') && !document.body.dataset.accountId) {
    if (connection) connection.textContent = 'Zaloguj się';
    if (counter) counter.textContent = '';
    return;
  }
  let count = 0;
  try { count = (await pendingOperations()).length; } catch { syncError = 'Brak dostępu do pamięci offline'; }
  if (connection) {
    connection.textContent = navigator.onLine ? (syncError ? 'Zapis lokalny · sprawdź synchronizację' : 'Online') : 'Offline · zapis na urządzeniu';
    connection.title = syncError;
  }
  if (counter) counter.textContent = `${count} zmian oczekuje`;
}

let registrationPromise;
if ('serviceWorker' in navigator && window.isSecureContext) {
  const registration = navigator.serviceWorker.register('/service-worker.js', {scope: '/'})
    .then(() => navigator.serviceWorker.ready);
  registrationPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Przygotowanie offline trwa zbyt długo. Sprawdź HTTPS oraz dostępność plików /static/ i spróbuj ponownie.')), 15000);
    registration.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  }).catch(error => {
      syncError = `Nie zainstalowano trybu offline: ${error.message}`;
      refreshStatus();
      throw error;
    });
  // Registration failure is displayed in the status, without an unhandled promise.
  registrationPromise.catch(() => {});
}

window.addEventListener('workout-local-change', refreshStatus);
window.addEventListener('workout-sync-error', event => { syncError = event.detail.message; refreshStatus(); });
window.addEventListener('workout-sync-success', () => { syncError = ''; refreshStatus(); });
window.addEventListener('offline', refreshStatus);
window.addEventListener('online', () => { syncError = ''; refreshStatus(); syncAll(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshStatus(); if (navigator.onLine) syncAll(); } });
// A temporary server outage need not produce an online/offline browser event.
// Retry while the app is open; the durable queue is kept until a real ACK.
setInterval(() => { if (navigator.onLine && !document.hidden) syncAll(); }, 15000);

document.addEventListener('click', async event => {
  const button = event.target.closest('.prepare-offline');
  if (!button) return;
  event.preventDefault();
  if (button.disabled) return;
  const oldLabel = button.textContent;
  button.disabled = true;
  let feedback = button.parentElement.querySelector('.offline-feedback');
  if (!feedback) {
    feedback = document.createElement('p');
    feedback.className = 'offline-feedback notice';
    feedback.setAttribute('role', 'status');
    button.after(feedback);
  }
  try {
    if (!navigator.onLine) throw new Error('Przygotowanie treningu wymaga połączenia. Pobraną wcześniej sesję możesz wznowić offline.');
    if (!window.isSecureContext || !registrationPromise) throw new Error('Tryb offline wymaga HTTPS (lub localhost). Skonfiguruj bezpieczny dostęp z telefonu zgodnie z README.');
    button.textContent = 'Przygotowywanie…';
    await registrationPromise;
    const dateInput = document.querySelector('[name="date"]');
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // Stable across failed retries, until the server response and IndexedDB commit.
    const storageKey = `prepare-workout-${button.dataset.planId}`;
    const workoutId = localStorage.getItem(storageKey) || uuid();
    localStorage.setItem(storageKey, workoutId);
    const data = await jsonRequest(`/api/plans/${button.dataset.planId}/prepare/`, {workout_id: workoutId, date: dateInput?.value || localDate});
    const workout = data.workout || data;
    await cacheWorkout(workout);
    localStorage.setItem(lastWorkoutKey, workout.id);
    localStorage.removeItem(storageKey);
    feedback.textContent = 'Trening rozpoczęty i zapisany na tym urządzeniu. Możesz ćwiczyć bez połączenia. ';
    const link = document.createElement('a');
    link.href = `/workouts/${workout.id}/`;
    link.textContent = 'Przejdź do treningu →';
    link.className = 'button';
    feedback.append(link);
    button.textContent = 'Pobrano do pracy offline';
    refreshStatus();
  } catch (error) {
    feedback.textContent = error.message;
    button.textContent = oldLabel;
    button.disabled = false;
  }
});

refreshStatus();
if (navigator.onLine) syncAll();

document.addEventListener('submit', async event => {
  if (!['account-logout','logout-confirmation'].includes(event.target.id)) return;
  event.preventDefault();
  const form=event.target;
  try {
    const pending=await pendingOperations();
    if (pending.length) { alert(`Najpierw zsynchronizuj ${pending.length} zmian treningu. Otwórz trening online i poczekaj na zapis.`); return; }
    await clearCurrentOfflineData();
    form.submit();
  } catch (error) { alert(error.message); }
});
