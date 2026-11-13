/* Static app test. Start: python -m http.server 8080 --directory web */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const origin=process.env.LOCAL_APP_URL||'http://127.0.0.1:8080/';
const artifacts=process.env.ARTIFACT_DIR||path.join(os.tmpdir(),'sila-local-browser');
async function noOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Układ wykracza poza ekran');}
async function view(page,route){await page.goto(origin+'#/'+route);await page.locator('main h1').waitFor();await noOverflow(page);}
async function state(page){return page.evaluate(async()=>await(await import('./storage.mjs')).readState());}
async function download(page,selector){const ready=page.waitForEvent('download');await page.locator(selector).click();const item=await ready;return fs.readFile(await item.path(),'utf8');}
async function save(page){await page.locator('#set-form button[type=submit]').click();await page.waitForTimeout(550);}
(async()=>{
  await fs.mkdir(artifacts,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
  try {
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
      const page=await context.newPage(),errors=[],posts=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});page.on('dialog',d=>d.accept());
      await view(page,'start');await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await page.locator('[data-action=demo]').click();await page.getByRole('heading',{name:'Cześć, Kolarz DEMO'}).waitFor();
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-start.png`),fullPage:true});
      await view(page,'plans');assert.equal(await page.locator('main .grid .card').count(),6);
      await page.locator('main .list a').first().click();await page.locator('[data-form=start-workout] button').click();
      await page.locator('#set-form').waitFor();const workoutUrl=page.url();assert.match(await page.locator('h1').innerText(),/DEMO — przysiad/);
      const start=Number(await page.locator('#weight').inputValue());
      for(const delta of [-10,-5,-1,1,5,10])await page.locator(`[data-action=adjust][data-field=weight][data-delta="${delta}"]`).click();
      assert.equal(Number(await page.locator('#weight').inputValue()),start);
      await page.locator('[data-field=reps][data-delta="1"]').click();assert.equal(await page.locator('.set-list>li').count(),1);assert.match(await page.locator('.set-list').innerText(),/Nie zapisano/);
      await page.locator('#weight').fill('61,5');await save(page);assert.equal(await page.locator('#weight').inputValue(),'61.5');assert.equal(await page.locator('#reps').inputValue(),'9');await save(page);assert.equal((await state(page)).workouts[0].exercises[0].sets.length,2);assert.equal((await state(page)).workouts[0].exercises[0].sets[1].reps,9);
      assert.match(await page.locator('#rest-timer').innerText(),/0:[0-5]\d|1:00/);
      await page.locator('[data-action=edit-set]').first().click();await page.locator('#weight').fill('62');await save(page);assert.equal((await state(page)).workouts[0].exercises[0].sets[0].weight,'62');
      await page.locator('[data-action=delete-set]').last().click();assert.equal((await state(page)).workouts[0].exercises[0].sets.length,1);
      await noOverflow(page);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-workout.png`),fullPage:true});
      await context.setOffline(true);await page.locator('[data-action=next]').click();await page.getByRole('heading',{name:'DEMO — wejście na stopień',exact:true}).waitFor();
      await page.locator('#weight').fill('14,5');await page.locator('#reps').fill('11');await save(page);await page.reload();await page.locator('#set-form').waitFor();assert.match(await page.locator('h1').innerText(),/wejście na stopień/);assert.equal((await state(page)).workouts[0].exercises[1].sets.length,1);assert.equal(await page.locator('#weight').inputValue(),'14.5');assert.equal(await page.locator('#reps').inputValue(),'11');
      await page.locator('[data-action=previous]').click();await page.getByRole('heading',{name:'DEMO — przysiad',exact:true}).waitFor();assert.match(await page.locator('.set-list').innerText(),/62 kg/);
      await page.locator('[data-action=next]').click();await page.getByRole('heading',{name:'DEMO — wejście na stopień',exact:true}).waitFor();await page.locator('[data-action=next]').click();await page.getByRole('heading',{name:'DEMO — deska',exact:true}).waitFor();
      assert.equal(await page.locator('#reps').count(),0);await page.locator('#seconds').fill('45');await save(page);
      assert.equal((await state(page)).workouts[0].exercises[2].sets.length,1,'Timed set was not saved');
      // A second tab concurrently records another set; IDB serializes changes.
      const other=await context.newPage();await other.goto(workoutUrl);await other.locator('#set-form').waitFor();
      const result=await Promise.all([page.evaluate(async()=>{const D=await import('./domain.mjs'),S=await import('./storage.mjs');return S.mutate(s=>D.saveSet(s,s.workouts[0].id,s.workouts[0].exercises[2].id,{id:D.uid(),weight:'0',seconds:50,note:'tab A'}));}),other.evaluate(async()=>{const D=await import('./domain.mjs'),S=await import('./storage.mjs');return S.mutate(s=>D.saveSet(s,s.workouts[0].id,s.workouts[0].exercises[2].id,{id:D.uid(),weight:'0',seconds:55,note:'tab B'}));})]);
      assert.equal((await state(page)).workouts[0].exercises[2].sets.length,3);await other.close();
      await page.locator('[data-action=finish]').click();await page.getByRole('heading',{name:'Trening zakończony'}).waitFor();assert.equal(await page.locator('#set-form').count(),0);
      await page.reload();await page.getByRole('heading',{name:'Trening zakończony'}).waitFor();assert.equal((await state(page)).workouts[0].status,'completed');
      const rejection=await page.evaluate(async()=>{const D=await import('./domain.mjs'),S=await import('./storage.mjs');try{await S.mutate(s=>D.saveSet(s,s.workouts[0].id,s.workouts[0].exercises[0].id,{weight:1,reps:1}));return false;}catch{return true;}});assert(rejection);
      await view(page,'exercise/demo-ex-1');assert.equal(await page.locator('.chart circle').count(),1);assert.match(await page.locator('table').innerText(),/62/);
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,`${mobile?'mobile':'desktop'}-progress.png`),fullPage:true});
      await view(page,'exercise/demo-ex-3');assert.match(await page.locator('table').innerText(),/55 s/);assert.equal(await page.locator('[data-form=rm]').count(),0);
      await view(page,'settings');const backup=await download(page,'[data-action=export-all]');assert.equal(JSON.parse(backup).data.workouts.length,1);
      const csv=await download(page,'[data-action=export-csv]');assert.match(csv,/"62"/);
      await page.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.locator('[data-action=import-confirm]').waitFor();await page.locator('[data-action=import-confirm]').click();await page.getByRole('heading',{name:'Profile',exact:true}).waitFor();assert.equal((await state(page)).profiles.length,2);assert.equal((await state(page)).workouts.length,2);
      await view(page,'settings');await page.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('już zaimportowany'));assert.equal((await state(page)).workouts.length,2);
      const before=JSON.stringify(await state(page));await page.locator('#import-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('poprawnym JSON'));assert.equal(JSON.stringify(await state(page)),before);
      await context.setOffline(false);await page.reload();await page.locator('main h1').waitFor();assert.equal((await state(page)).workouts.length,2);assert.equal(posts.length,0,'Training data was sent to the server');assert.deepEqual(errors,[]);
      // Start again: recall this profile's last actual weight, not its plan's 50 kg.
      const original=(await state(page)).profiles[0],originalPlan=(await state(page)).plans[0];
      await page.locator('#active-profile').selectOption(original.id);await page.getByRole('heading',{name:'Cześć, Kolarz DEMO',exact:true}).waitFor();
      await view(page,`plan/${originalPlan.id}`);await page.locator('[data-form=start-workout] button').click();await page.locator('#set-form').waitFor();
      assert.equal(await page.locator('#weight').inputValue(),'62');assert.equal(await page.locator('#reps').inputValue(),'9');
      await page.locator('#weight').fill('0');await page.locator('#reps').fill('0');await save(page);assert.equal(await page.locator('#weight').inputValue(),'0');assert.equal(await page.locator('#reps').inputValue(),'0');await page.reload();await page.locator('#set-form').waitFor();assert.equal(await page.locator('#weight').inputValue(),'0');assert.equal(await page.locator('#reps').inputValue(),'0');
      // A typed draft and an explicitly edited set take priority over the suggestion.
      await page.locator('#weight').fill('77.25');await page.locator('#reps').fill('13');await page.locator('[data-action=next]').click();await page.getByRole('heading',{name:'DEMO — wejście na stopień',exact:true}).waitFor();
      assert.equal(await page.locator('#weight').inputValue(),'14.5');assert.equal(await page.locator('#reps').inputValue(),'11');await page.locator('[data-action=previous]').click();await page.getByRole('heading',{name:'DEMO — przysiad',exact:true}).waitFor();assert.equal(await page.locator('#weight').inputValue(),'77.25');assert.equal(await page.locator('#reps').inputValue(),'13');
      await page.locator('[data-action=edit-set]').click();await page.waitForFunction(()=>document.querySelector('#set-form h2').textContent.startsWith('Edytuj'));assert.equal(await page.locator('#weight').inputValue(),'0');assert.equal(await page.locator('#reps').inputValue(),'0');await page.locator('[data-action=cancel-edit]').click();await page.waitForFunction(()=>document.querySelector('#set-form h2').textContent.startsWith('Seria'));assert.equal(await page.locator('#weight').inputValue(),'77.25');assert.equal(await page.locator('#reps').inputValue(),'13');
      // Same exercise, another profile: no leakage of remembered weights.
      const fixture=await page.evaluate(async()=>{
        const D=await import('./domain.mjs'),{mutate}=await import('./storage.mjs');
        return (await mutate(s=>{
          const p=D.addProfile(s,{name:'Drugi profil'});D.measure(s,'rms',p.id,{date:D.today(),exercise_id:'demo-ex-1',value:'100'});D.measure(s,'rms',p.id,{date:D.today(),exercise_id:'friel-ex-1',value:'100'});
          const plan=D.createPlan(s,p.id,{name:'Test innej osoby',phase_id:'DEMO'});D.addPlanItems(s,plan.id,[{slot_id:'DEMO-1',exercise_id:'demo-ex-1'}]);
          const us=D.createPlan(s,p.id,{name:'Test US',phase_id:'US'});D.addPlanItems(s,us.id,[{slot_id:'US-1',exercise_id:'friel-ex-1',chosen_sets:3}]);
          return {plan:plan.id,us:us.id};
        })).result;
      });
      await page.goto(origin+'#/plan/'+fixture.plan);await page.reload();await page.locator('[data-form=start-workout] button').click();await page.locator('#set-form').waitFor();assert.equal(await page.locator('#weight').inputValue(),'50');assert.equal(await page.locator('#reps').inputValue(),'8');
      // US still assigns the endpoint loads; an unspecified middle stays blank.
      await view(page,`plan/${fixture.us}`);await page.locator('[data-form=start-workout] button').click();await page.locator('#set-form').waitFor();assert.equal(await page.locator('#weight').inputValue(),'60');
      await page.locator('#weight').fill('65.5');await page.locator('#reps').fill('7');await save(page);assert.equal(await page.locator('#weight').inputValue(),'');assert.equal(await page.locator('#reps').inputValue(),'7');await page.locator('#weight').fill('67.5');await save(page);assert.equal(await page.locator('#weight').inputValue(),'80');assert.equal(await page.locator('#reps').inputValue(),'7');
      await noOverflow(page);assert.deepEqual(errors,[]);
      console.log(`PASS ${mobile?'phone 390×844':'desktop 1440×1000'}: controls, sessions, time, offline reload/finish, multi-tab commits, real charts, export/import/duplicates/invalid backup, no POST requests`);
      console.log('PASS remembered weights and reps: next set, offline reload, next workout, zero, draft/edit priority, profile isolation, US endpoints');
      await context.close();
    }
    // A brand new device recovers its data entirely from a JSON file.
    const source=await browser.newContext(),page=await source.newPage();await view(page,'start');await page.locator('[data-action=demo]').click();await page.getByRole('heading',{name:'Cześć, Kolarz DEMO'}).waitFor();await view(page,'settings');const raw=await download(page,'[data-action=export-all]');
    const clean=await browser.newContext(),fresh=await clean.newPage();await view(fresh,'settings');await fresh.locator('#import-file').setInputFiles({name:'copy.json',mimeType:'application/json',buffer:Buffer.from(raw)});await fresh.locator('[data-action=import-confirm]').click();await fresh.getByRole('heading',{name:'Profile',exact:true}).waitFor();assert.equal((await state(fresh)).plans.length,1);assert.equal((await state(fresh)).rms[0].value,'100');
    // Phase selection, source defaults, form error retention and manual overrides.
    await view(fresh,'plan/new/AA');await fresh.locator('[data-form=plan-create] button').click();await fresh.locator('[data-form=plan-add]').waitFor();assert.equal(await fresh.locator('input[type=checkbox]:checked').count(),8);
    await fresh.locator('[data-form=plan-add] button[type=submit]').click();await fresh.locator('[data-form=start-workout]').waitFor();assert.equal((await state(fresh)).plans.at(-1).items.length,8);
    const planId=(await state(fresh)).plans.at(-1).id,itemId=(await state(fresh)).plans.at(-1).items[0].id;
    await view(fresh,`plan/${planId}/item/${itemId}`);await fresh.locator('#sets_min').fill('9');await fresh.locator('#sets_max').fill('3');await fresh.locator('[data-form=item-edit] button[type=submit]').click();await fresh.waitForFunction(()=>document.querySelector('#notice').dataset.error==='true');assert.equal(await fresh.locator('#sets_min').inputValue(),'9');await fresh.locator('#sets_max').fill('10');await fresh.locator('[data-form=item-edit] button[type=submit]').click();await fresh.locator('[data-form=start-workout]').waitFor();assert((await state(fresh)).plans.at(-1).items[0].overridden);
    await source.close();await clean.close();console.log('PASS fresh-device restore; AA eight ready exercises; invalid form retains input; manual plan overrides');
    console.log('Screenshots:',artifacts);
  } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
