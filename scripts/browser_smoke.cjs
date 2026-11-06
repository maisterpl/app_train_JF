/* Requires a running DEMO instance, and npm install. Uses new DEMO sessions. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const origin = process.env.APP_URL || 'http://127.0.0.1:8000';
const artifacts = process.env.ARTIFACT_DIR || path.join(os.tmpdir(), 'sila-browser');
fs.mkdirSync(artifacts, {recursive:true});

async function pending(page, count) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const actual = await page.evaluate(async () => (await (await import('/static/training/workout.js')).pendingOperations()).length);
    if (actual === count) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Kolejka nie otrzymała potwierdzenia serwera w ciągu 20 sekund.');
}
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Układ wykracza poza ekran');
}

(async () => {
  const options = {headless:true, args:['--no-sandbox']};
  if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(options);
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({viewport:mobile ? {width:390,height:844} : {width:1440,height:1000}, isMobile:mobile, hasTouch:mobile});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/');
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await noOverflow(page);
      await page.screenshot({path:artifacts + (mobile ? '/mobile-start.png' : '/desktop-start.png'),fullPage:true});
      await page.goto(origin + '/plans/');
      const detail = await page.locator('a').evaluateAll(links => links.find(a => /^\/plans\/\d+\/$/.test(a.getAttribute('href')))?.getAttribute('href'));
      assert(detail, 'Brak planu DEMO');
      await page.goto(origin + detail);
      await noOverflow(page);
      if (mobile) {
        await page.locator('.prepare-offline').click();
        const readyLink = page.locator('.offline-feedback a');
        await readyLink.waitFor();
        await readyLink.click();
      } else {
        await page.locator('form[action$="/start/"] button[type=submit]').click();
      }
      await page.locator('#set-form').waitFor();
      await page.waitForURL(/\/workouts\/[0-9a-f-]+\//);
      const workoutUrl = page.url();
      const workoutId = workoutUrl.match(/workouts\/([^/]+)/)[1];
      assert.match(await page.locator('#workout-app h1').innerText(), /przysiad/);
      const startWeight = Number(await page.locator('#set-weight').inputValue());
      for (const delta of ['1','5','10','-1','-5','-10']) await page.locator(`[data-action=adjust][data-field=weight][data-delta="${delta}"]`).click();
      assert.equal(Number(await page.locator('#set-weight').inputValue()), startWeight);
      await page.locator('[data-action=adjust][data-field=reps][data-delta="1"]').click();
      assert.equal(await page.locator('.set-list li').count(), 0, 'Przycisk +/- wysłał formularz');
      await page.screenshot({path:artifacts + (mobile ? '/mobile-workout.png' : '/desktop-workout.png'),fullPage:true});
      await noOverflow(page);
      if (mobile) await context.setOffline(true);
      await page.locator('#set-form button[type=submit]').click();
      await page.locator('.set-list li').waitFor();
      assert.match(await page.locator('#rest-timer').innerText(), /:/);
      await page.locator('#set-form button[type=submit]').click();
      await page.waitForFunction(() => document.querySelectorAll('.set-list li').length === 2);
      assert.match(await page.locator('.set-list li').nth(1).innerText(), /Seria 2/);
      await page.locator('.set-list li').first().locator('[data-action=edit-set]').click();
      await page.locator('#set-weight').fill('55.50');
      await page.locator('#set-form button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('.set-list li')?.textContent.includes('55.50') || document.querySelector('.set-list li')?.textContent.includes('55.5'));
      await page.locator('.set-list li').nth(1).locator('[data-action=delete-set]').click();
      await page.waitForFunction(() => document.querySelectorAll('.set-list li').length === 1);
      await page.locator('[data-action=next]').click();
      await page.waitForFunction(() => document.querySelector('#workout-app h1')?.textContent.includes('stopień'));
      assert.equal(await page.locator('.set-list li').count(), 0);
      await page.locator('[data-action=previous]').click();
      await page.waitForFunction(() => document.querySelectorAll('.set-list li').length === 1);
      await page.reload();
      await page.locator('#set-form').waitFor();
      assert.match(await page.locator('.set-list').innerText(), /55.5/);
      if (mobile) {
        // Reopening an installed PWA uses start_url=/, with no network.
        await page.goto(origin + '/');
        await page.locator('#set-form').waitFor();
        assert.match(await page.locator('.set-list').innerText(), /55.5/);
        assert.match(await page.locator('#pending-count').innerText(), /[1-9]/);
      }
      await page.locator('[data-action=next]').click();
      await page.waitForFunction(() => document.querySelector('#workout-app h1')?.textContent.includes('stopień'));
      await page.locator('[data-action=skip]').click();
      await page.waitForFunction(() => document.querySelector('#workout-app h1')?.textContent.includes('deska'));
      await page.locator('#set-amount').fill('35');
      await page.locator('#set-form button[type=submit]').click();
      await page.locator('.set-list li').waitFor();
      assert.match(await page.locator('.set-list').innerText(), /35 s/);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-action=finish]').click();
      await page.waitForFunction(() => !document.querySelector('#set-form'));
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#workout-app')?.textContent.includes('Trening zakończony'));
      assert.equal(await page.locator('#set-form').count(), 0);
      if (mobile) await context.setOffline(false);
      await pending(page, 0);
      const data = await page.evaluate(async id => (await (await fetch(`/api/workouts/${id}/`)).json()).workout, workoutId);
      assert.equal(data.status, 'completed');
      assert.equal(data.exercises[0].sets.length, 1);
      assert.equal(data.exercises[0].sets[0].weight, '55.5');
      assert.equal(data.exercises[1].skipped, true);
      assert.equal(data.exercises[2].sets[0].seconds, 35);
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`${mobile ? 'MOBILE+OFFLINE' : 'DESKTOP'} PASS: controls, set/edit/delete, navigation, skip, refresh/resume, finish, server results; ${workoutId}`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exit(1);});
