/* Integration check against a running local Django server.
 * Install Playwright separately; run: node scripts/browser_sync_edges.cjs
 * Optional: APP_TEST_URL, BROWSER_TEST_PYTHON, BROWSER_TEST_CHROMIUM.
 * Uses and deletes a separate QA profile; it never changes DEMO results. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const python = process.env.BROWSER_TEST_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const baseURL = process.env.APP_TEST_URL || 'http://127.0.0.1:8000';

function django(code) {
  const result = spawnSync(python, ['-c', `import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup();\n${code}`], {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

const fixture = JSON.parse(django(`
import json, uuid
from training.models import Profile,Plan,PlanItem,BodyWeight,OneRepMax
from training.services import prescription_data
from django.utils import timezone
source=Plan.objects.filter(phase__is_demo=True,items__isnull=False).first()
assert source, 'Najpierw python manage.py seed_demo'
p=Profile.objects.create(name='QA synchronizacja '+str(uuid.uuid4())[:8])
BodyWeight.objects.create(profile=p,date=timezone.localdate(),value=80)
plan=Plan.objects.create(profile=p,name='QA — synchronizacja',phase=source.phase)
for i in source.items.all():
 PlanItem.objects.create(plan=plan,exercise=i.exercise,position=i.position,**prescription_data(i))
 OneRepMax.objects.create(profile=p,exercise=i.exercise,date=timezone.localdate(),value=100)
print(json.dumps({'profile':p.pk,'plan':plan.pk}))
`));

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
async function waitFor(test, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(message);
}

(async () => {
  let browser;
  let context;
  try {
    const launchOptions = {headless: true, args: ['--no-sandbox']};
    if (process.env.BROWSER_TEST_CHROMIUM) launchOptions.executablePath = process.env.BROWSER_TEST_CHROMIUM;
    else if (process.platform !== 'win32' && require('node:fs').existsSync('/usr/bin/chromium')) launchOptions.executablePath = '/usr/bin/chromium';
    browser = await chromium.launch(launchOptions);
    // Transport failure scenarios are tested independently of SW interception.
    context = await browser.newContext({baseURL, serviceWorkers: 'block'});
    const page = await context.newPage();
    await page.goto('/');
    await page.evaluate(async profileId => {
      const token = (await (await fetch('/api/csrf/')).json()).csrfToken;
      const response = await fetch(`/profiles/${profileId}/switch/`, {method: 'POST', headers: {'X-CSRFToken': token}});
      if (!response.ok) throw new Error('Nie wybrano profilu QA');
    }, fixture.profile);
    const prepared = await page.evaluate(async planId => {
      const token = (await (await fetch('/api/csrf/')).json()).csrfToken;
      const response = await fetch(`/api/plans/${planId}/prepare/`, {method:'POST', headers:{'Content-Type':'application/json','X-CSRFToken':token}, body:JSON.stringify({workout_id:crypto.randomUUID()})});
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.workout;
    }, fixture.plan);
    await page.goto(`/workouts/${prepared.id}/`);
    await page.waitForSelector('#set-form');
    const exerciseId = prepared.exercises[0].id;
    const setA = require('node:crypto').randomUUID();
    const syncURL = `**/api/workouts/${prepared.id}/sync/`;
    const queue = operation => page.evaluate(async ({workoutId,operation}) => {
      const m = await import('/static/training/workout.js');
      await m.queueOperation(workoutId, operation);
    }, {workoutId:prepared.id,operation});
    const pending = () => page.evaluate(async workoutId => (await (await import('/static/training/workout.js')).pendingOperations(workoutId)).length, prepared.id);
    const local = () => page.evaluate(async workoutId => (await import('/static/training/workout.js')).getWorkout(workoutId), prepared.id);
    const remote = async () => {
      const response = await context.request.get(`/api/workouts/${prepared.id}/`);
      assert.equal(response.status(), 200);
      return (await response.json()).workout;
    };

    // Server commits; the response is lost. The outbox must survive and replay.
    const lostAck = deferred();
    let lostAckRequests = 0;
    await page.route(syncURL, async route => {
      lostAckRequests++;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
      lostAck.resolve();
    });
    await queue({id:require('node:crypto').randomUUID(),type:'set.upsert',exercise_id:exerciseId,set:{id:setA,weight:'60',reps:8,seconds:null,note:'QA lost ack'}});
    await page.evaluate(workoutId => { import('/static/training/workout.js').then(m => m.syncWorkout(workoutId)).catch(() => {}); }, prepared.id);
    await lostAck.promise;
    await page.waitForTimeout(120);
    assert.equal(await pending(), 1, 'Lost ACK must retain the operation');
    assert.equal((await remote()).exercises[0].sets.length, 1, 'Server committed before response loss');
    await page.unroute(syncURL);
    await page.evaluate(async workoutId => (await import('/static/training/workout.js')).syncWorkout(workoutId), prepared.id);
    assert.equal(await pending(), 0);
    assert.equal((await remote()).exercises[0].sets.length, 1, 'Replay must not duplicate the set');
    assert.equal(lostAckRequests, 1);
    console.log('PASS: lost acknowledgement retains outbox; UUID replay creates no duplicate');

    // Edit B is made while A's old server response is held in transit.
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const secondStarted = deferred();
    const releaseSecond = deferred();
    let calls = 0;
    await page.route(syncURL, async route => {
      calls++;
      if (calls === 1) {
        const response = await route.fetch();
        firstStarted.resolve();
        await releaseFirst.promise;
        await route.fulfill({response});
      } else {
        secondStarted.resolve();
        await releaseSecond.promise;
        await route.continue();
      }
    });
    const setB = require('node:crypto').randomUUID();
    await queue({id:require('node:crypto').randomUUID(),type:'set.upsert',exercise_id:exerciseId,set:{id:setB,weight:'61',reps:8,seconds:null,note:'QA in flight A'}});
    await page.evaluate(workoutId => { window.edgeSync = import('/static/training/workout.js').then(m => m.syncWorkout(workoutId)); }, prepared.id);
    await firstStarted.promise;
    await queue({id:require('node:crypto').randomUUID(),type:'set.upsert',exercise_id:exerciseId,set:{id:setB,weight:'73',reps:9,seconds:null,note:'QA newer B'}});
    assert.equal(await pending(), 2);
    releaseFirst.resolve();
    await secondStarted.promise;
    const optimisticSet = (await local()).exercises[0].sets.find(s => s.id === setB);
    assert.equal(Number(optimisticSet.weight), 73, 'Older response must rebase the newer local edit');
    assert.equal(await pending(), 1, 'Only acknowledged A is removed');
    releaseSecond.resolve();
    await page.evaluate(() => window.edgeSync);
    assert.equal(await pending(), 0);
    const remoteSet = (await remote()).exercises[0].sets.find(s => s.id === setB);
    assert.equal(Number(remoteSet.weight), 73);
    assert.equal(remoteSet.reps, 9);
    assert.equal((await remote()).exercises[0].sets.length, 2);
    console.log('PASS: edit during in-flight sync survives old response and reaches Django');
    await page.unroute(syncURL);

    // An acknowledgement refresh must preserve a partly typed form and focus.
    const draftStarted = deferred();
    const releaseDraft = deferred();
    await page.route(syncURL, async route => {
      const response = await route.fetch();
      draftStarted.resolve();
      await releaseDraft.promise;
      await route.fulfill({response});
    });
    await queue({id:require('node:crypto').randomUUID(),type:'set.upsert',exercise_id:exerciseId,set:{id:require('node:crypto').randomUUID(),weight:'66',reps:6,seconds:null,note:'QA draft trigger'}});
    await page.evaluate(workoutId => { window.edgeDraftSync = import('/static/training/workout.js').then(m => m.syncWorkout(workoutId)); }, prepared.id);
    await draftStarted.promise;
    await page.locator('#set-weight').fill('77.25');
    await page.locator('#set-amount').fill('12');
    await page.locator('#set-note').fill('Niedokończona notatka');
    await page.locator('#set-note').evaluate(input => input.setSelectionRange(3, 7));
    await page.evaluate(() => { window.draftInputNode = document.getElementById('set-amount'); });
    releaseDraft.resolve();
    await page.evaluate(() => window.edgeDraftSync);
    await waitFor(async () => await pending() === 0, 'ACK queue did not empty');
    assert.equal(await page.locator('#set-weight').inputValue(), '77.25');
    assert.equal(await page.locator('#set-amount').inputValue(), '12');
    assert.equal(await page.locator('#set-note').inputValue(), 'Niedokończona notatka');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'set-note');
    assert.deepEqual(await page.locator('#set-note').evaluate(input => [input.selectionStart,input.selectionEnd]), [3,7]);
    assert.equal(await page.evaluate(() => window.draftInputNode === document.getElementById('set-amount')), true, 'ACK must leave the live form nodes attached');
    await page.unroute(syncURL);
    await page.locator('#set-form button[type="submit"]').click();
    await waitFor(async () => (await remote()).exercises[0].sets.some(s => Number(s.weight) === 77.25 && s.reps === 12 && s.note === 'Niedokończona notatka'), 'Typed draft did not reach server');
    console.log('PASS: ACK refresh preserves typed weight, repetitions, note, focus and selection');
    await waitFor(async () => await pending() === 0 && await page.locator('#set-form button[type="submit"]').isEnabled(), 'Submit guard did not finish');
    for (const offline of [true, false]) {
      if (offline) await context.setOffline(true);
      const before = (await local()).exercises[0].sets.length;
      await page.locator('#set-weight').fill(offline ? '81' : '82');
      await page.locator('#set-amount').fill('10');
      await page.locator('#set-form button[type="submit"]').dblclick({delay: 60});
      await waitFor(async () => await page.locator('#set-form button[type="submit"]').isEnabled(), 'Submit debounce did not finish');
      assert.equal((await local()).exercises[0].sets.length, before + 1, `${offline ? 'Offline' : 'Online'} double tap created extra sets`);
      if (offline) {
        assert.equal(await pending(), 1, 'Offline double tap must queue exactly one mutation');
        await context.setOffline(false);
      }
      await page.evaluate(async workoutId => (await import('/static/training/workout.js')).syncWorkout(workoutId), prepared.id);
      assert.equal((await remote()).exercises[0].sets.length, before + 1);
    }
    console.log('PASS: offline and online double-click each creates exactly one set');
    console.log('4 browser synchronisation edge checks passed.');
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    django(`from training.models import Profile; Profile.objects.filter(pk=${fixture.profile}).delete()`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
