const {authenticateBrowser}=require('./browser_test_account.cjs');
/* Real-browser checks for sourced phase data and per-set US prescriptions.
 * Requires migrated local Django server; creates and removes its own QA profile.
 * npm install; npx playwright install chromium; node scripts/browser_friel.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const python = process.env.BROWSER_TEST_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const baseURL = process.env.APP_TEST_URL || 'http://127.0.0.1:8000';
function django(code) {
  const result = spawnSync(python, ['-c', `import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup();\n${code}`], {cwd:root, encoding:'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
async function waitFor(check, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
const fixture = JSON.parse(django(`
import json,uuid
from decimal import Decimal
from django.utils import timezone
from training.models import Profile,BodyWeight,OneRepMax,Phase,Plan,PlanItem,Exercise
from training.services import prescription_data,start_workout
p=Profile.objects.create(name='QA Friel '+str(uuid.uuid4())[:8],rounding_step=Decimal('0.5'))
BodyWeight.objects.create(profile=p,date=timezone.localdate(),value=80)
for name,weight in [('Przysiad',100),('Step',50),('Wypychanie nogami',200),('Wiosłowanie na siedząco',80),('Skłony ze skrętem',90)]:
 OneRepMax.objects.create(profile=p,exercise=Exercise.objects.get(name=name),date=timezone.localdate(),value=weight)
def workout(code,label,positions,chosen=None,middle=None,override=False):
 phase=Phase.objects.get(code=code)
 plan=Plan.objects.create(profile=p,phase=phase,name='QA Friel '+label)
 for position,variant in positions:
  slot=phase.slots.get(position=position)
  values=prescription_data(slot)
  if values['series_load_mode']=='endpoints':
   values.update(chosen_sets=chosen,middle_weight=middle)
  if override: values.update(reps_min=9,reps_max=12)
  PlanItem.objects.create(plan=plan,slot=slot,exercise=Exercise.objects.get(name=variant) if variant else slot.default_exercise,position=position,**values)
 return str(start_workout(plan).pk)
ids={
 'us2':workout('US','2 serie — Step',[(1,'Step')],2),
 'us3':workout('US','3 serie — środek brak danych',[(1,'Przysiad')],3),
 'us_custom':workout('US','3 serie — własny środek',[(1,'Przysiad')],3,Decimal('67.5')),
 'sm':workout('SM','cel i AA',[(2,None),(3,None)]),
 'sm_unknown':workout('SM','nieznany cel wariantu',[(1,'Wypychanie nogami')]),
 'sm_override':workout('SM','własne powtórzenia',[(2,None)],override=True),
}
print(json.dumps({'profile':p.pk,'workouts':ids,'rm_count':p.one_rep_maxes.count()}))
`));

(async () => {
  let browser, context;
  try {
    const options={headless:true,args:['--no-sandbox']};
    if (process.env.BROWSER_TEST_CHROMIUM) options.executablePath=process.env.BROWSER_TEST_CHROMIUM;
    else if (process.platform !== 'win32' && fs.existsSync('/usr/bin/chromium')) options.executablePath='/usr/bin/chromium';
    browser=await chromium.launch(options);
    context=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await authenticateBrowser(context,fixture.profile);
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('/');
    await page.evaluate(async profile=>{
      const token=(await(await fetch('/api/csrf/')).json()).csrfToken;
      const response=await fetch(`/profiles/${profile}/switch/`,{method:'POST',headers:{'X-CSRFToken':token}});
      if (!response.ok) throw new Error('Nie wybrano profilu QA');
    },fixture.profile);
    const load=async id=>{
      await page.goto(`/workouts/${id}/`);
      await page.locator('#set-form').waitFor();
      await waitFor(async()=>await page.locator('#set-weight').isVisible(),'Brak formularza serii');
    };
    const submit=async(expectSaved=true)=>{
      const previous=await page.locator('.set-list li').count();
      await page.locator('#set-form button[type=submit]').click();
      if (expectSaved) await waitFor(async()=>await page.locator('.set-list li').count()===previous+1,'Nie zapisano nowej serii');
      await waitFor(async()=>await page.locator('#set-form button[type=submit]').isEnabled(),'Zapis serii nie zakończył się');
    };
    const weight=()=>page.locator('#set-weight').inputValue();
    const body=()=>page.locator('#workout-app').innerText();
    const pending=id=>page.evaluate(async id=>(await(await import('/static/training/workout.js')).pendingOperations(id)).length,id);

    await load(fixture.workouts.us2);
    assert.equal(await weight(),'30','US variant must use its own Step1RM=50');
    await submit();
    assert.equal(await weight(),'40','Second of two sets must be80% own1RM');
    await submit();
    assert.equal(await weight(),'','Additional set has no source prescription');
    assert.match(await body(),/Brak danych dla dodatkowej serii/);
    console.log('PASS: US2 uses selected variant1RM and60%→80%; additional set is manual');

    await load(fixture.workouts.us_custom);
    assert.equal(await weight(),'60');
    assert.match(await body(),/Ustawienie własne/);
    await submit();
    assert.equal(await weight(),'67.5');
    await submit();
    assert.equal(await weight(),'80');
    console.log('PASS: explicit own middle weight remains67.5kg, never an invented70%');

    await load(fixture.workouts.us3);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await waitFor(async()=>await page.evaluate(()=>!!navigator.serviceWorker.controller),'Service worker nie przejął strony');
    await context.setOffline(true);
    assert.equal(await weight(),'60');
    await submit();
    assert.equal(await weight(),'','Unknown middle set must require manual input');
    assert.match(await body(),/Ustal własny ciężar środkowej serii/);
    const before=await page.locator('.set-list li').count();
    await submit(false);
    assert.equal(await page.locator('.set-list li').count(),before,'Blank middle weight cannot be silently replaced with zero');
    await page.locator('#set-weight').fill('67.5');
    await submit();
    assert.equal(await weight(),'80');
    await page.reload();
    await page.locator('#set-form').waitFor();
    assert.equal(await weight(),'80','US per-set prescription must survive an offline reload');
    await submit();
    await page.locator('.set-list li').first().locator('[data-action=edit-set]').click();
    assert.match(await page.locator('.workout-targets').innerText(),/Obciążenie serii1|Obciążenie serii 1/);
    assert.match(await page.locator('.workout-targets').innerText(),/60 kg/);
    await page.locator('[data-action=cancel-edit]').click();
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('[data-action=finish]').click();
    await waitFor(async()=>await page.locator('#set-form').count()===0,'Nie zakończono offline');
    await context.setOffline(false);
    await page.evaluate(async id=>(await import('/static/training/workout.js')).syncWorkout(id),fixture.workouts.us3);
    await waitFor(async()=>await pending(fixture.workouts.us3)===0,'Nie potwierdzono kolejki US');
    const remote=await page.evaluate(async id=>(await(await fetch(`/api/workouts/${id}/`)).json()).workout,fixture.workouts.us3);
    assert.equal(remote.status,'completed');
    assert.deepEqual(remote.exercises[0].sets.map(set=>Number(set.weight)),[60,67.5,80]);
    console.log('PASS: US3 unknown middle requires manual input;60/own/80 survives offline reload and sync');

    await load(fixture.workouts.sm);
    assert.equal(await weight(),'','SM goal cannot become planned weight');
    assert.match(await body(),/3–6\+/);
    assert.match(await page.locator('.end-goal').innerText(),/40–64 kg/);
    assert.match(await page.locator('.end-goal').innerText(),/Nie jest ciężarem pierwszego treningu/);
    await page.locator('[data-action=next]').click();
    await waitFor(async()=>/Skłony ze skrętem/.test(await page.locator('#workout-app h1').innerText()),'Nie zmieniono ćwiczenia pomocniczego');
    assert.match(await page.locator('.parameter-origin').innerText(),/AA/);
    assert.match(await page.locator('.workout-targets').innerText(),/20–30/);
    assert.equal(await weight(),'','Core load must stay unknown even when a manual1RM exists');
    assert.equal(await page.locator('.end-goal').count(),0);
    console.log('PASS: SM end goal separate from load; helper keepsAA and core load stays unknown');

    await load(fixture.workouts.sm_unknown);
    assert.equal(await weight(),'');
    assert.match(await page.locator('.end-goal').innerText(),/Brak danych/);
    assert.match(await page.locator('.end-goal').innerText(),/13\.3/);
    await load(fixture.workouts.sm_override);
    assert.match(await page.locator('.workout-targets').innerText(),/9–12/);
    assert.doesNotMatch(await page.locator('.workout-targets').innerText(),/3–6\+/);
    assert.match(await body(),/Powtórzenia według źródła:3–6\+|Powtórzenia według źródła: 3–6\+/);
    assert.equal(errors.length,0,errors.join('\n'));
    assert.equal(Number(django(`from training.models import Profile; print(Profile.objects.get(pk=${fixture.profile}).one_rep_maxes.count())`)),fixture.rm_count);
    console.log('PASS: unknown variant goal not copied; custom repetitions retain separate original+source; sets never change1RM');
    console.log('6 Friel browser checks passed.');
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    django(`from training.models import Profile; Profile.objects.filter(pk=${fixture.profile}).delete()`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
