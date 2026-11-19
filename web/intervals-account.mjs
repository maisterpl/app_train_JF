// Credentials are separate from training state and JSON backups.
export const KEY_PREFIX='sila-intervals-account:';
export function loadAccount(profileId,storage=localStorage) {
  const raw=storage.getItem(KEY_PREFIX+profileId);if(!raw)return null;
  try{const value=JSON.parse(raw);return typeof value.key==='string'&&value.key.trim()&&typeof value.id==='string'&&typeof value.name==='string'?value:null;}catch{return null;}
}
export function saveAccount(profileId,account,storage=localStorage) {
  storage.setItem(KEY_PREFIX+profileId,JSON.stringify({id:account.id,name:account.name,key:account.key}));
}
export function removeAccount(profileId,storage=localStorage) {storage.removeItem(KEY_PREFIX+profileId);}
