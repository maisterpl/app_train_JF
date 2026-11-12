/* Authenticated UI/offline checks; uses and removes its own QA accounts. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const python=process.env.BROWSER_TEST_PYTHON||path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const baseURL=process.env.APP_TEST_URL||'http://127.0.0.1:8000';
const password='QA-only-long-password-913!';
function django(code){const r=spawnSync(python,['-c',`import os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');import django;django.setup();\n${code}`],{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout.trim();}
const fixture=JSON.parse(django(`
import json,uuid
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
from training.models import Profile,Plan,PlanItem,Phase,Exercise
tag=str(uuid.uuid4())[:8]
users=[];profiles=[]
for name in ['alice','bob','admin']:
 u=get_user_model().objects.create_user(username='qa_'+name+'_'+tag,email='qa_'+name+'_'+tag+'@example.test',password='${password}',is_staff=name=='admin',is_superuser=name=='admin')
 EmailAddress.objects.create(user=u,email=u.email,verified=True,primary=True)
 users.append(u)
for u in users[:2]: profiles.append(Profile.objects.create(owner=u,name='Profil '+u.username))
exercise=Exercise.objects.create(name='QA konto '+tag)
plans=[]
for p in profiles:
 plan=Plan.objects.create(profile=p,phase=Phase.objects.get(code='AA'),name='QA plan '+p.name)
 PlanItem.objects.create(plan=plan,exercise=exercise,basis='fixed',fixed_weight=20,reps_min=8,sets_min=2,rest_seconds=10)
 plans.append(plan)
print(json.dumps({'users':[u.pk for u in users],'emails':[u.email for u in users],'profiles':[p.pk for p in profiles],'names':[p.name for p in profiles],'plans':[p.pk for p in plans],'exercise':exercise.pk}))
`));
async function waitFor(check){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,60));}throw Error('Przekroczono czas oczekiwania');}
(async()=>{
 let browser;
 try{
  const options={headless:true,args:['--no-sandbox']};
  if(process.env.BROWSER_TEST_CHROMIUM)options.executablePath=process.env.BROWSER_TEST_CHROMIUM;
  else if(process.platform!=='win32'&&fs.existsSync('/usr/bin/chromium'))options.executablePath='/usr/bin/chromium';
  browser=await chromium.launch(options);
  for(const mobile of [false,true]){
   const context=await browser.newContext({baseURL,viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
   try{
    const page=await context.newPage(),errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
    async function login(index){await page.goto('/accounts/login/');await page.locator('[name=login]').fill(fixture.emails[index]);await page.locator('[name=password]').fill(password);await page.locator('main form button[type=submit]').last().click();await page.waitForURL(/\/$/);}
    await page.goto('/profiles/');assert.match(page.url(),/accounts\/login/);
    await login(0);await page.goto('/profiles/');
    assert.match(await page.locator('main').innerText(),new RegExp(fixture.names[0]));
    assert(!((await page.locator('main').innerText()).includes(fixture.names[1])));
    assert.equal((await context.request.get(`/plans/${fixture.plans[1]}/`)).status(),404);
    await page.goto(`/plans/${fixture.plans[0]}/`);await page.locator('form[action$="/start/"] button[type=submit]').click();await page.locator('#set-form').waitFor();
    const id=page.url().match(/workouts\/([^/]+)/)[1];
    await page.evaluate(()=>navigator.serviceWorker.ready);await waitFor(()=>page.evaluate(()=>!!navigator.serviceWorker.controller));
    await context.setOffline(true);await page.locator('#set-weight').fill('30');await page.locator('#set-form button[type=submit]').click();await page.locator('.set-list li').waitFor();
    const pending=()=>page.evaluate(async()=>(await(await import('/static/training/workout.js')).pendingOperations()).length);
    assert.equal(await pending(),1);
    const blockedClear=await page.evaluate(async()=>{try{await(await import('/static/training/workout.js')).clearCurrentOfflineData();return '';}catch(error){return error.message;}});assert.match(blockedClear,/zsynchronizuj/);assert.equal(await pending(),1);
    const beforeDialog=dialogs.length;await page.locator('#account-logout button').click();await waitFor(async()=>dialogs.length>beforeDialog);assert.match(dialogs[dialogs.length-1],/zsynchronizuj/);assert.equal(await pending(),1);
    await page.locator('[data-action=finish]').click();await waitFor(async()=>await page.locator('#set-form').count()===0);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#workout-app')?.textContent.includes('Trening zakończony'));
    await context.setOffline(false);await waitFor(async()=>await pending()===0);
    const saved=(await(await context.request.get(`/api/workouts/${id}/`)).json()).workout;assert.equal(saved.status,'completed');assert.equal(saved.exercises[0].sets[0].weight,'30');
    await page.reload();await page.locator('#account-logout button').waitFor();
    await page.locator('#account-logout button').click();await page.waitForURL(/accounts\/login/,{timeout:8000}).catch(e=>{console.log('Logout diagnostic',page.url(),dialogs.slice(-2));throw e;});
    assert.equal((await context.request.get(`/api/workouts/${id}/`)).status(),401);
    await login(1);
    assert.equal(await page.evaluate(async()=>(await(await import('/static/training/workout.js')).allWorkouts()).length),0,'Drugi użytkownik zobaczył lokalną historię pierwszego');
    assert.equal((await context.request.get(`/api/workouts/${id}/`)).status(),404);
    await page.locator('#account-logout button').click();await page.waitForURL(/accounts\/login/,{timeout:8000}).catch(e=>{console.log('Logout diagnostic',page.url(),dialogs.slice(-2));throw e;});
    await login(2);await page.goto('/profiles/');assert.match(await page.locator('main').innerText(),new RegExp(fixture.names[0]));
    await page.locator(`form[action="/profiles/${fixture.profiles[0]}/switch/"] button`).click();await page.goto(`/exercises/${fixture.exercise}/`);await page.locator('.exercise-progress-svg').waitFor();assert.match(await page.locator('#progress-selected-result').innerText(),/30 kg/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Układ przepełnia ekran');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log(`PASS ${mobile?'MOBILE':'DESKTOP'}: email login, ownership, offline save/finish/reload/sync, guarded logout, account cache separation, administrator graph`);
   }finally{await context.close();}
  }
 }finally{
  if(browser)await browser.close();
  django(`from django.contrib.auth import get_user_model;from training.models import Profile,Exercise;Profile.objects.filter(pk__in=${JSON.stringify(fixture.profiles)}).delete();Exercise.objects.filter(pk=${fixture.exercise}).delete();get_user_model().objects.filter(pk__in=${JSON.stringify(fixture.users)}).delete()`);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
