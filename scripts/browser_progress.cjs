/* Real progress chart checks. Requires migrated Django; removes its QA data. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const python = process.env.BROWSER_TEST_PYTHON || path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const baseURL = process.env.APP_TEST_URL || 'http://127.0.0.1:8000';
function django(code) {
  const result=spawnSync(python,['-c',`import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup();\n${code}`],{cwd:root,encoding:'utf8'});
  if(result.status!==0) throw new Error(result.stderr||result.stdout);
  return result.stdout.trim();
}
const fixture=JSON.parse(django(`
import json,uuid
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from training.models import Profile,Exercise,Workout,WorkoutExercise,WorkoutSet
tag=str(uuid.uuid4())[:8]
p=Profile.objects.create(name='QA wykres '+tag)
other=Profile.objects.create(name='QA inny wykres '+tag)
exercise=Exercise.objects.create(name='QA ciężar '+tag,mode='reps')
timed=Exercise.objects.create(name='QA czas '+tag,mode='time')
empty=Exercise.objects.create(name='QA bez historii '+tag,mode='reps')
day=timezone.localdate()-timedelta(days=30)
def workout(person,offset,weight,reps,status='completed'):
 now=timezone.now()
 w=Workout.objects.create(profile=person,plan_name='QA wykres',phase_name='QA',training_date=day+timedelta(days=offset),started_at=now,finished_at=now+timedelta(minutes=30) if status=='completed' else None,status=status)
 e=WorkoutExercise.objects.create(workout=w,exercise=exercise,position=1,snapshot={'exercise_id':exercise.pk,'name':exercise.name,'mode':'reps'})
 WorkoutSet.objects.create(workout_exercise=e,number=1,weight=Decimal(str(weight)),reps=reps)
 return w,e
w1,e1=workout(p,0,55,12)
WorkoutSet.objects.create(workout_exercise=e1,number=2,weight=60,reps=8)
repeat=WorkoutExercise.objects.create(workout=w1,exercise=exercise,position=2,snapshot={'exercise_id':exercise.pk,'name':exercise.name,'mode':'reps'})
WorkoutSet.objects.create(workout_exercise=repeat,number=1,weight=58,reps=20)
w2,e2=workout(p,1,65,6)
w3,e3=workout(p,20,'72.5',5)
WorkoutSet.objects.create(workout_exercise=e3,number=2,weight=999,reps=1,deleted=True)
workout(p,21,1000,1,status='active')
workout(other,25,888,1)
for w,seconds in [(w1,30),(w3,45)]:
 e=WorkoutExercise.objects.create(workout=w,exercise=timed,position=3,snapshot={'exercise_id':timed.pk,'name':timed.name,'mode':'time'})
 WorkoutSet.objects.create(workout_exercise=e,number=1,weight=500,seconds=seconds)
print(json.dumps({'profiles':[p.pk,other.pk],'profile':p.pk,'exercise':exercise.pk,'timed':timed.pk,'empty':empty.pk,'exercises':[exercise.pk,timed.pk,empty.pk],'workouts':[str(w1.pk),str(w2.pk),str(w3.pk)]}))
`));
(async()=>{
 let browser;
 try {
  const options={headless:true,args:['--no-sandbox']};
  if(process.env.BROWSER_TEST_CHROMIUM) options.executablePath=process.env.BROWSER_TEST_CHROMIUM;
  else if(process.platform!=='win32'&&fs.existsSync('/usr/bin/chromium')) options.executablePath='/usr/bin/chromium';
  browser=await chromium.launch(options);
  for(const mobile of [false,true]) {
   const context=await browser.newContext({baseURL,viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
   try {
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/');
    await page.evaluate(async id=>{
     const token=(await(await fetch('/api/csrf/')).json()).csrfToken;
     await fetch(`/profiles/${id}/switch/`,{method:'POST',headers:{'X-CSRFToken':token}});
    },fixture.profile);
    await page.goto(`/exercises/${fixture.exercise}/#progress-chart`);
    await page.locator('#progress-controls:not([hidden])').waitFor();
    const data=await page.locator('#exercise-progress-data').evaluate(node=>JSON.parse(node.textContent));
    assert.deepEqual(data.map(p=>p.value),[60,65,72.5]);
    assert.deepEqual(data.map(p=>p.reps),[8,6,5]);
    assert.equal(await page.locator('.progress-point').count(),3,'One point per session, not per exercise position');
    assert(data[1].x-data[0].x<data[2].x-data[1].x,'Date spacing must reflect time');
    assert.equal(await page.locator('.progress-axis-unit').first().textContent(),'kg');
    assert.match(await page.locator('#progress-selected-result').innerText(),/72,5 kg × 5/);
    await page.locator('.progress-point[data-progress-index="2"]').click();
    await page.locator('#progress-previous').click();
    assert.match(await page.locator('#progress-selected-result').innerText(),/65 kg × 6/);
    await page.locator('#progress-previous').click();
    assert.match(await page.locator('#progress-selected-result').innerText(),/60 kg × 8/);
    assert(await page.locator('#progress-previous').isDisabled());
    await page.locator('.progress-point[data-progress-index="0"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('#progress-selected-result').innerText(),/65 kg × 6/);
    assert.equal(await page.locator('#progress-selected-link').getAttribute('href'),`/workouts/${fixture.workouts[1]}/`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Progress view overflows screen');
    await page.screenshot({path:path.join(os.tmpdir(),`exercise-progress-${mobile?'mobile':'desktop'}.png`),fullPage:true});
    await page.locator('#progress-selected-link').click();
    const link=page.locator(`a[href="/exercises/${fixture.exercise}/#progress-chart"]`);
    await link.waitFor();
    await link.click();
    await page.locator('#progress-controls:not([hidden])').waitFor();
    await page.goto(`/exercises/${fixture.timed}/`);
    const timeData=await page.locator('#exercise-progress-data').evaluate(node=>JSON.parse(node.textContent));
    assert.deepEqual(timeData.map(p=>p.value),[30,45]);
    assert.equal(await page.locator('.progress-axis-unit').first().textContent(),'s');
    assert.match(await page.locator('#progress-selected-result').innerText(),/45 s/);
    assert.doesNotMatch(await page.locator('.progress-summary').innerText(),/500/);
    await page.goto(`/exercises/${fixture.empty}/`);
    assert.equal(await page.locator('.exercise-progress-svg').count(),0);
    assert.match(await page.locator('#progress-chart').innerText(),/To ćwiczenie nie ma jeszcze zapisanej historii/);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log(`PASS ${mobile?'MOBILE':'DESKTOP'}: real maxima/context/date spacing, profile isolation, click/buttons/keyboard, history links, timed chart, empty state`);
   } finally {await context.close();}
  }
 } finally {
  if(browser) await browser.close();
  django(`from training.models import Profile,Exercise; Profile.objects.filter(pk__in=${JSON.stringify(fixture.profiles)}).delete(); Exercise.objects.filter(pk__in=${JSON.stringify(fixture.exercises)}).delete()`);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
