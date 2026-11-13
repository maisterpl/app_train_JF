/* Requires the static web/ server on LOCAL_APP_URL (default localhost:8080). */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const origin=process.env.LOCAL_APP_URL||'http://127.0.0.1:8080/';
const artifacts=process.env.ARTIFACT_DIR||path.join(os.tmpdir(),'sila-custom-browser');
const state=page=>page.evaluate(async()=>await(await import('./storage.mjs')).readState());
async function view(page,route){await page.goto(origin+'#/'+route);await page.locator('main h1').waitFor();}
async function noOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Layout overflows screen');}
async function fillItem(page,values){for(const [key,value] of Object.entries(values)){const input=page.locator(`[data-form=custom-item] [name="${key}"]`);if(['exercise_id','basis'].includes(key))await input.selectOption(value);else await input.fill(String(value));}await noOverflow(page);await page.locator('[data-form=custom-item] button[type=submit]').click();await page.locator('[data-form=start-workout]').waitFor();}
async function saveSet(page){await page.locator('#set-form button[type=submit]').click();await page.waitForTimeout(550);}
(async()=>{
  await fs.mkdir(artifacts,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
  try{
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
      const page=await context.newPage(),errors=[],posts=[];let acceptDialogs=true;
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});page.on('dialog',d=>acceptDialogs?d.accept():d.dismiss());
      await view(page,'start');await page.locator('[data-action=demo]').click();await page.getByRole('heading',{name:'Cześć, Kolarz DEMO'}).waitFor();await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const original=await state(page);
      await view(page,'plans');await page.getByRole('link',{name:'Utwórz własny plan',exact:true}).click();await page.locator('#name').fill('Mój własny trening');await page.locator('[data-form=custom-plan] button').click();await page.locator('[data-form=custom-item]').waitFor();
      await fillItem(page,{exercise_id:'demo-ex-1',sets_min:3,sets_max:4,reps_min:8,reps_max:10,rest_seconds:90,rest_seconds_max:120,basis:'rm',percent_min:60,percent_max:70,notes:'Mój zapis techniki'});
      const plan=(await state(page)).plans.find(p=>p.kind==='custom'),planId=plan.id;
      assert.match(await page.locator('main').innerText(),/60–70 kg/);assert.match(await page.locator('main').innerText(),/Mój zapis techniki/);
      // User exercise: duplicates fail without changing the library or losing form data.
      await view(page,'exercises');await page.getByRole('link',{name:'Dodaj własne ćwiczenie',exact:true}).click();await page.locator('#name').fill('Przysiad');await page.locator('#category').fill('Moje nogi');await page.locator('[data-form=exercise-create] button').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('już w bazie'));assert.equal(await page.locator('#category').inputValue(),'Moje nogi');assert.equal((await state(page)).exercises.length,original.exercises.length);
      await page.locator('#name').fill('Moje wyciskanie hantli');await page.locator('#description').fill('Stabilny ruch.');await page.locator('#load_notation').fill('Łączny ciężar obu hantli w kg');await page.locator('[data-form=exercise-create] button').click();await page.getByRole('heading',{name:'Moje wyciskanie hantli',exact:true}).waitFor();
      const newExercise=(await state(page)).exercises.at(-1);assert(newExercise.is_custom);
      await view(page,`plan/${planId}/add`);await fillItem(page,{exercise_id:newExercise.id,sets_min:2,reps_min:12,rest_seconds:0,basis:'body',percent_min:25,notes:'Ćwiczenie własne'});assert.match(await page.locator('main').innerText(),/20 kg/);
      // Create a timed exercise directly while preparing a plan.
      await view(page,`plan/${planId}/add`);await page.getByRole('link',{name:'+ Dodaj nowe ćwiczenie do bazy',exact:true}).click();await page.locator('#name').fill('Moja deska');await page.locator('#mode').selectOption('time');await page.locator('#load_notation').fill('Bez dodatkowego ciężaru');await page.locator('[data-form=exercise-create] button').click();await page.locator('[data-form=custom-item]').waitFor();
      assert.equal(await page.locator('#exercise_id').inputValue(),(await state(page)).exercises.at(-1).id);assert.equal(await page.locator('#reps_min').isEnabled(),false);
      await fillItem(page,{sets_min:2,seconds:45,rest_seconds:30,basis:'none',notes:'Swobodny oddech'});
      // Existing source plans/phase slots have not been rewritten.
      let current=await state(page);assert.deepEqual(current.plans[0],original.plans[0]);assert.deepEqual(current.phases,original.phases);assert.deepEqual(current.slots,original.slots);assert.equal(current.plans.find(p=>p.id===planId).items.length,3);
      await page.locator('[data-action=move][data-delta="-1"]').last().click();await page.waitForFunction(id=>document.querySelector(`[data-id="${id}"][data-delta="1"]`)!=null,current.plans.find(p=>p.id===planId).items.at(-1).id);
      const timeId=current.plans.find(p=>p.id===planId).items.at(-1).id;await page.locator(`[data-action=move][data-id="${timeId}"][data-delta="1"]`).click();
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-custom-plan.png`),fullPage:true});await noOverflow(page);
      // A range error leaves all entered parameters on the screen.
      const firstItem=(await state(page)).plans.find(p=>p.id===planId).items[0].id;
      await view(page,`plan/${planId}/item/${firstItem}`);await page.locator('#sets_min').fill('9');await page.locator('[data-form=custom-item] button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#notice').dataset.error==='true');assert.equal(await page.locator('#notes').inputValue(),'Mój zapis techniki');assert.equal(await page.locator('#sets_min').inputValue(),'9');await page.locator('#sets_min').fill('3');await page.locator('[data-form=custom-item] button[type=submit]').click();await page.locator('[data-form=start-workout]').waitFor();
      await page.locator('[data-form=start-workout] button').click();await page.locator('#set-form').waitFor();const completedUrl=page.url();await context.setOffline(true);
      await page.locator('#weight').fill('62.5');await saveSet(page);await page.locator('[data-action=next]').click();await page.getByRole('heading',{name:newExercise.name,exact:true}).waitFor();assert.equal(await page.locator('#weight').inputValue(),'20');await saveSet(page);
      await page.locator('[data-action=next]').click();await page.getByRole('heading',{name:'Moja deska',exact:true}).waitFor();assert.equal(await page.locator('#seconds').inputValue(),'45');assert.equal(await page.locator('#reps').count(),0);await saveSet(page);await page.reload();await page.locator('#set-form').waitFor();await page.locator('[data-action=finish]').click();await page.getByRole('heading',{name:'Trening zakończony'}).waitFor();
      const finished=(await state(page)).workouts[0];assert.equal(finished.exercises.length,3);assert.equal(finished.exercises[0].snapshot.notes,'Mój zapis techniki');
      await view(page,`plan/${planId}/item/${firstItem}`);await page.locator('#notes').fill('Nowe uwagi dla kolejnej sesji');await page.locator('[data-form=custom-item] button[type=submit]').click();await page.locator('[data-form=start-workout]').waitFor();assert.equal((await state(page)).workouts[0].exercises[0].snapshot.notes,'Mój zapis techniki');
      await page.locator('[data-form=start-workout] button').click();await page.locator('#set-form').waitFor();const activeUrl=page.url();
      await view(page,'settings');const downloadReady=page.waitForEvent('download');await page.locator('[data-action=export-all]').click();const download=await downloadReady,backup=await fs.readFile(await download.path());assert(JSON.parse(backup).data.plans.some(p=>p.kind==='custom'));
      // Delete from Your plans: cancellation first, then deletion. History stays.
      await view(page,'plans');const remove=()=>page.locator('[data-action=delete-plan][data-id="'+planId+'"]');acceptDialogs=false;await remove().click();assert((await state(page)).plans.some(p=>p.id===planId));acceptDialogs=true;await remove().click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Plan usunięty'));
      current=await state(page);assert(!current.plans.some(p=>p.id===planId));assert.equal(current.workouts.length,2);assert(current.workouts.every(w=>w.plan_id===null));assert.deepEqual(current.plans[0],original.plans[0]);assert.deepEqual(current.slots,original.slots);
      await page.goto(completedUrl);await page.getByRole('heading',{name:'Trening zakończony'}).waitFor();assert.match(await page.locator('main').innerText(),/62,5 kg/);await page.goto(activeUrl);await page.locator('#set-form').waitFor();
      await view(page,'settings');await page.locator('#import-file').setInputFiles({name:'custom-backup.json',mimeType:'application/json',buffer:backup});await page.locator('[data-action=import-confirm]').click();await page.getByRole('heading',{name:'Profile',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'Profile',exact:true}).waitFor();
      current=await state(page);const restored=current.plans.find(p=>p.kind==='custom');assert(restored);assert.equal(restored.items.length,3);assert.equal(restored.items[1].prescription.basis,'body');assert(current.exercises.find(e=>e.id===restored.items[1].exercise_id).is_custom);assert.deepEqual(current.plans[0],original.plans[0]);assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);await noOverflow(page);
      console.log(`PASS ${mobile?'phone':'desktop'}: own plans/reps/time/rest/RM/body/notes, own exercises/duplicate validation, edit/order, offline workout, immutable snapshots, delete/cancel/preserve history, export/import; original plans unchanged`);
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
