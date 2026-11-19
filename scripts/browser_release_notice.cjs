const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});try{
for(const width of [390,1280]){const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
await page.goto('http://127.0.0.1:8091/');const dialog=page.locator('dialog');await dialog.waitFor();assert.match(await dialog.innerText(),/Zdjęcia ćwiczeń/);
await page.locator('#release-close').click();await page.reload();await dialog.waitFor();
await page.locator('#release-hide').check();await page.locator('#release-close').click();await page.reload();await page.locator('main h1').waitFor();assert.equal(await page.locator('dialog[open]').count(),0);
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
await context.close();console.log('Release dialog passed: '+width);}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
