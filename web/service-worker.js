const RELEASE = '832a4f17cd3ef184';
const PREFIX='sila-local-shell-';
const CACHE=PREFIX+RELEASE;
const ASSETS=['./','./index.html','./style.css','./app.mjs','./domain.mjs','./ai-training.mjs','./storage.mjs','./backup.mjs','./intervals.mjs','./intervals-account.mjs','./catalog.json','./release.json','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const EXERCISE_IMAGES=[
  ...Array.from({length:11},(_,i)=>`./exercise-friel-ex-${i+1}.jpg`),
  './exercise-pompki.jpg',
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Fail the install if any required file is missing. Do not activate an
  // incomplete offline app, and do not reuse stale HTTP-cache assets.
  await cache.addAll([...ASSETS,...EXERCISE_IMAGES].map(url=>new Request(url,{cache:'reload'})));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys()) if(name.startsWith(PREFIX)&&name!==CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data==='activate') self.skipWaiting();if(event.data==='release-info'&&event.ports[0])event.waitUntil((async()=>{try{const cache=await caches.open(CACHE),response=await cache.match('./release.json');event.ports[0].postMessage(response?await response.json():null);}catch{event.ports[0].postMessage(null);}})());});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate') return await cache.match('./index.html') || fetch(event.request);
    const hit=await cache.match(event.request,{ignoreSearch:true});
    return hit||fetch(event.request);
  })());
});
