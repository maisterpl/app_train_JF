/* Verify that ready phase sets are discoverable and editable from Plans.
 * Requires migrated Django on localhost:8000. Removes its own QA profile. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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
const fixture = JSON.parse(django(`
import json,uuid
from training.models import Profile,Phase
p=Profile.objects.create(name='QA gotowe zestawy '+str(uuid.uuid4())[:8])
print(json.dumps({'profile':p.pk,'aa':{s.position:s.pk for s in Phase.objects.get(code='AA').slots.all()},'us':{s.position:s.pk for s in Phase.objects.get(code='US').slots.all()}}))
`));
(async()=>{
  let browser;
  try {
    const options = {headless:true,args:['--no-sandbox']};
    if (process.env.BROWSER_TEST_CHROMIUM) options.executablePath = process.env.BROWSER_TEST_CHROMIUM;
    else if (process.platform !== 'win32' && fs.existsSync('/usr/bin/chromium')) options.executablePath = '/usr/bin/chromium';
    browser = await chromium.launch(options);
    for (const mobile of [false,true]) {
      const context = await browser.newContext({baseURL,viewport:mobile ? {width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto('/');
        await page.evaluate(async id=>{
          const token=(await(await fetch('/api/csrf/')).json()).csrfToken;
          const response=await fetch(`/profiles/${id}/switch/`,{method:'POST',headers:{'X-CSRFToken':token}});
          if(!response.ok) throw new Error('Nie wybrano profilu QA');
        },fixture.profile);
        await page.goto('/plans/');
        assert.equal(await page.locator('.phase-template').count(),5);
        for(const code of ['AA','SM','WM','WS','US']) assert.equal(await page.locator(`#phase-template-${code} li`).count(),code==='AA'?8:6);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Przepełnienie układu');
        await page.screenshot({path:path.join(os.tmpdir(),`friel-catalog-${mobile?'mobile':'desktop'}.png`),fullPage:true});
        await page.locator('#phase-template-AA a').click();
        assert.equal(await page.locator('[name=name]').inputValue(),'AA — adaptacja anatomiczna');
        await page.locator('form button[type=submit]').click();
        await page.waitForURL(/\/plans\/\d+\/add\/\?preset=1/);
        assert.equal(await page.locator('.slot-selection-form input[type=checkbox]:checked').count(),8);
        const first = await page.locator(`[name=exercise_${fixture.aa[1]}]`).inputValue();
        const third = await page.locator(`[name=exercise_${fixture.aa[3]}]`).inputValue();
        assert.notEqual(first,third);
        await page.locator(`[name=select_${fixture.aa[6]}]`).uncheck();
        await page.locator('.slot-selection-form button[type=submit]').click();
        await page.waitForURL(/\/plans\/\d+\/$/);
        assert.equal(await page.locator('.plan-exercise').count(),7);
        assert.equal(await page.locator('.plan-exercise').filter({hasText:'Uginanie nóg leżąc'}).count(),0);
        assert.equal(await page.locator('.slot-selection-form').count(),0);
        await page.goto('/plans/');
        await page.locator('#phase-template-US a').click();
        await page.locator('form button[type=submit]').click();
        await page.waitForURL(/\/plans\/\d+\/add\/\?preset=1/);
        assert.equal(await page.locator('.slot-selection-form input[type=checkbox]:checked').count(),6);
        const series = page.locator(`[name=sets_${fixture.us[1]}]`);
        assert.equal(await series.inputValue(),'2');
        await series.selectOption('3');
        await page.locator('.slot-selection-form button[type=submit]').click();
        await page.waitForURL(/\/plans\/\d+\/$/);
        assert.equal(await page.locator('.plan-exercise').count(),6);
        assert.match(await page.locator('.plan-exercise').first().innerText(),/Środkowa seria|środkowej serii/);
        assert.equal(errors.length,0,errors.join('\n'));
        console.log(`PASS ${mobile?'MOBILE':'DESKTOP'}: five ready sets, AA preselection/deselection/default variants, US explicit 2→3, saved selected exercises`);
      } finally {await context.close();}
    }
  } finally {
    if(browser) await browser.close();
    django(`from training.models import Profile; Profile.objects.filter(pk=${fixture.profile}).delete()`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
