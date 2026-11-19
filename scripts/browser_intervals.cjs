const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});try{for(const mode of ['note','new','existing']){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await ctx.newPage(),writes=[];
 await page.route('https://intervals.icu/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url());let body={id:'i999'};
 if(req.method()==='POST'){writes.push({path:url.pathname,body:req.postDataJSON()});}
 else if(url.pathname.endsWith('/athlete/0'))body={id:'i42',name:'Konto testowe'};
 else if(url.pathname.endsWith('/activities'))body=[{id:'i777',name:'Garmin siła',start_date_local:'2026-11-19T10:00:00',type:'WeightTraining'}];
 else body=[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto('http://127.0.0.1:8091/');await page.locator('#release-close').click();await page.locator('[data-action=demo]').click();await page.waitForTimeout(150);
 const id=await page.evaluate(async()=>{const S=await import('./storage.mjs'),D=await import('./domain.mjs');return (await S.mutate(s=>{const w=D.startWorkout(s,s.plans[0].id,'2026-11-19');D.saveSet(s,w.id,w.exercises[0].id,{id:D.uid(),weight:'40',reps:12});D.finish(s,w.id);return w.id;})).result;});
 await page.goto('http://127.0.0.1:8091/#/settings');await page.reload();await page.locator('#release-close').click();await page.locator('#icu-key').fill('fake-test-key');if(mode==='note')await page.locator('[name=remember_key]').check();assert.equal(await page.getByRole('link',{name:/ustawienia Intervals/}).getAttribute('href'),'https://intervals.icu/settings');await page.locator('[data-form=icu-connect] button').click();await page.getByText('Konto testowe',{exact:true}).waitFor();
 await page.goto('http://127.0.0.1:8091/#/interval-export/'+id);
 if(mode!=='note'){await page.locator('[name=export_type]').selectOption('strength');await page.locator('[name=strength_mode]').selectOption(mode);if(mode==='new'){await page.locator('[name=duplicate_ack]').check();}else{await page.locator('[data-action=icu-load]').click();await page.locator('[name=activity_id] option[value=i777]').waitFor({state:'attached'});await page.locator('[name=activity_id]').selectOption('i777');}}
 page.once('dialog',d=>d.accept());await page.locator('[data-form=icu-export] button[type=submit]').click();await page.getByText('Ten trening był już wysłany',{exact:false}).waitFor();assert.equal(writes.length,1);assert.match(JSON.stringify(writes),/40 kg/);
 if(mode==='new'){assert.equal(writes[0].body.type,'WeightTraining');}if(mode==='note')assert.equal(writes[0].body.category,'NOTE');if(mode==='existing')assert.match(writes[0].path,/i777\/messages$/);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.reload();await page.locator('#release-close').click();if(mode==='note'){
 await page.getByText('Ten trening był już wysłany',{exact:false}).waitFor();
 const backup=await page.evaluate(async()=>JSON.stringify((await import('./backup.mjs')).makeBackup(await(await import('./storage.mjs')).readState())));assert(!backup.includes('fake-test-key'));
 const second=await ctx.newPage();await second.goto('http://127.0.0.1:8091/#/settings');await second.locator('#release-close').click();await second.getByText('Konto testowe',{exact:true}).waitFor();
 await page.goto('http://127.0.0.1:8091/#/settings');await page.locator('[data-action=icu-disconnect]').click();await second.locator('#icu-key').waitFor();
 await page.reload();await page.locator('#release-close').click();await page.locator('#icu-key').waitFor();
 }else await page.getByText('Najpierw połącz konto',{exact:false}).waitFor();
 await ctx.close();console.log('Passed Intervals export: '+mode);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
