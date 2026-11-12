/* Isolated static server: test subdirectory installation and real SW replacement.
 * No production files are changed and no public service is created. */
const {createServer}=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const web=path.resolve(__dirname,'../web'),base='/pages/app_train_JF/';
let version=1;
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(base))throw Error('path');
    const name=url.pathname.slice(base.length)||'index.html';if(name.includes('..')||name.includes('\\'))throw Error('path');
    let body=await fs.readFile(path.join(web,name));if(name==='service-worker.js')body=Buffer.from(body.toString().replace(/const RELEASE = '[^']*';/,`const RELEASE = 'test-${version}';`));
    res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  } catch {res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}${base}`;
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
  try {
    const context=await browser.newContext(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.locator('[data-action=demo]').waitFor();await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.locator('[data-action=demo]').click();await page.getByRole('heading',{name:'Cześć, Kolarz DEMO'}).waitFor();
    const before=await page.evaluate(async()=>await(await import('./storage.mjs')).readState());
    // A failed command must roll back all its partial writes.
    await page.evaluate(async()=>{const {mutate}=await import('./storage.mjs');try{await mutate(s=>{s.profiles[0].name='partial write';s.weights=[];throw Error('test abort');});}catch{}});
    const after=await page.evaluate(async()=>await(await import('./storage.mjs')).readState());assert.deepEqual(after,before);
    await page.goto(origin+'#/settings');await page.locator('[data-action=update]').waitFor();version=2;
    await page.locator('[data-action=update]').click();await page.locator('[data-action=apply-update]:visible').waitFor();
    const reload=page.waitForEvent('load');await page.locator('[data-action=apply-update]').click();await reload;await page.locator('main h1').waitFor();
    assert.deepEqual(await page.evaluate(async()=>await(await import('./storage.mjs')).readState()),before);
    const cacheNames=await page.evaluate(()=>caches.keys());assert(cacheNames.includes('sila-local-shell-test-2'));assert(!cacheNames.includes('sila-local-shell-test-1'));
    await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'Ustawienia',exact:true}).waitFor();assert.deepEqual(await page.evaluate(async()=>await(await import('./storage.mjs')).readState()),before);assert.deepEqual(errors,[]);
    await context.close();console.log('PASS subdirectory installation, IndexedDB rollback, real SW update/reload, old cache cleanup, data preserved after offline reload');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
