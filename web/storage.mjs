import {clone,newState,validateState} from './domain.mjs';

export const DATABASE_NAME='sila-na-trase-local-v1';
let database;
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(DATABASE_NAME):null;
export const changes=new EventTarget();
channel?.addEventListener('message',()=>changes.dispatchEvent(new Event('change')));
async function open() {
  if(database) return database;
  database=await new Promise((resolve,reject)=>{
    const req=indexedDB.open(DATABASE_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore('data');
    req.onsuccess=()=>{req.result.onversionchange=()=>{req.result.close();database=null;};resolve(req.result);};
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(Error('Zamknij pozostałe karty aplikacji i spróbuj ponownie.'));
  });
  return database;
}
export async function readState() {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('data','readonly'),req=tx.objectStore('data').get('state');
    tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);
  });
}
// The read and write share one IndexedDB transaction. Other tabs cannot overwrite
// a newer session with a stale in-memory copy. UI reports success only on commit.
export async function mutate(command) {
  const db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('data','readwrite'),store=tx.objectStore('data'),req=store.get('state');
    let state,result,failure;
    req.onsuccess=()=>{
      try {
        state=clone(req.result);if(!state) throw Error('Baza nie została przygotowana.');
        result=command(state);if(result?.then) throw Error('Zmiana musi być synchroniczna.');
        state.revision=(state.revision||0)+1;
        store.put(state,'state');
      } catch(error) { failure=error;tx.abort(); }
    };
    tx.oncomplete=()=>{channel?.postMessage({revision:state.revision});resolve({state,result});};
    tx.onabort=tx.onerror=()=>reject(failure||tx.error||Error('Nie udało się zapisać danych na urządzeniu.'));
  });
}
export async function initialize(catalog) {
  const db=await open();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('data','readwrite'),store=tx.objectStore('data'),req=store.get('state');
    req.onsuccess=()=>{if(!req.result) store.put(newState(catalog),'state');};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  const state=await readState();validateState(state);return state;
}
