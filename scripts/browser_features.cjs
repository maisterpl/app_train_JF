const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.LOCAL_APP_URL||'http://127.0.0.1:8080/';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
 try {
 for(const mobile of [false,true]) {
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'#/installation');await page.getByRole('heading',{name:'iPhone / iPad · Safari'}).waitFor();
 await page.goto(origin);await page.locator('[data-action=demo]').click();await page.waitForTimeout(500);
 await page.goto(origin+'#/exercise/new');await page.locator('#name').fill('Zdjęcie testowe');
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;c.getContext('2d').fillRect(0,0,40,40);return c.toDataURL('image/png').split(',')[1];});
 await page.locator('#photo-file').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
 await page.locator('[data-form=exercise-create] button[type=submit]').click();await page.locator('.exercise-photo summary').click();
 assert(await page.locator('.exercise-photo img').evaluate(i=>i.complete&&i.naturalWidth>0));
 const ids=await page.evaluate(async()=>{const S=await import('./storage.mjs'),D=await import('./domain.mjs');return (await S.mutate(s=>{const w=D.startWorkout(s,s.plans[0].id);w.started_at=new Date(Date.now()-65000).toISOString();s.exercises.find(e=>e.id===w.exercises[0].snapshot.exercise_id).photo=s.exercises.at(-1).photo;return w.id;})).result;});
 await page.goto(origin+'#/workout/'+ids);await page.reload();await page.locator('#workout-timer').waitFor();assert.match(await page.locator('#workout-timer').innerText(),/^00:01:/);
 await page.reload();await page.locator('#workout-timer').waitFor();assert.match(await page.locator('#workout-timer').innerText(),/^00:01:/);
 await page.locator('.exercise-photo summary').click();assert(await page.locator('.exercise-photo img').evaluate(i=>i.complete&&i.naturalWidth>0));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.goto(origin+'#/history');page.once('dialog',d=>d.dismiss());await page.locator('[data-action=delete-workout]').click();assert.equal(await page.locator('[data-action=delete-workout]').count(),1);
 page.once('dialog',d=>d.accept());await page.locator('[data-action=delete-workout]').click();await page.getByText('Nie masz jeszcze zapisanych treningów.').waitFor();assert.deepEqual(errors,[]);
 await context.close();console.log(mobile?'Mobile features passed':'Desktop features passed');
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

