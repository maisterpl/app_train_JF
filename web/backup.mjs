import {clone,newState,validateState,uid,prescription} from './domain.mjs';

export const MAX_BACKUP_BYTES=20*1024*1024;
export function makeBackup(state,profileId=null) {
  const data=clone(state);
  if(profileId) {
    data.profiles=data.profiles.filter(p=>p.id===profileId);
    for(const key of ['weights','rms','plans','workouts']) data[key]=data[key].filter(r=>r.profile_id===profileId);
    data.activeProfileId=profileId;
  }
  data.imported=[];data.lastExportAt=null;data.revision=0;
  return {format:'sila-na-trase-local',version:1,exported_at:new Date().toISOString(),data};
}
const record = (rows,label) => {
  if(!Array.isArray(rows)||rows.length>50000) throw Error(`Niepoprawna lista: ${label}.`);
  const ids=new Set();
  return rows.map(row=>{
    if(!row||typeof row.fields!=='object'||row.fields===null||!['number','string'].includes(typeof row.pk)||ids.has(String(row.pk))) throw Error(`Niepoprawny rekord: ${label}.`);
    ids.add(String(row.pk));return {...row.fields,id:String(row.pk)};
  });
};
// Offline migration from the complete JSON export produced by Django schema 2.
// Accounts and email addresses are deliberately discarded.
export function fromDjango(input) {
  if(input.schema_version!==2) throw Error('Obsługiwany jest eksport Django w wersji 2.');
  const s=newState({exercises:[],phases:[],slots:[],goals:[]});
  s.profiles=record(input.profile,'profile').map(p=>({id:p.id,name:p.name,notes:p.notes||'',rounding_step:p.rounding_step}));
  s.activeProfileId=s.profiles[0]?.id??null;
  s.exercises=record(input.exercises,'ćwiczenia');
  s.phases=record(input.phases,'fazy');
  s.slots=record(input.phase_slots,'pozycje faz').map(r=>({id:r.id,phase_id:String(r.phase),position:r.position,title:r.title,category:r.category,default_exercise_id:String(r.default_exercise),allowed_exercise_ids:r.allowed_exercises?.map(String),prescription:prescription(r)}));
  s.goals=record(input.strength_goals,'cele').map(r=>({...r,phase_id:String(r.phase),exercise_id:String(r.exercise)}));
  s.weights=record(input.body_weights,'masa').map(r=>({...r,profile_id:String(r.profile)}));
  s.rms=record(input.one_rep_max,'1RM').map(r=>({...r,profile_id:String(r.profile),exercise_id:String(r.exercise)}));
  const items=record(input.plan_items,'pozycje planu');
  s.plans=record(input.plans,'plany').map(r=>({id:r.id,name:r.name,profile_id:String(r.profile),phase_id:String(r.phase),items:items.filter(i=>String(i.plan)===r.id).sort((a,b)=>a.position-b.position).map(i=>({id:i.id,exercise_id:String(i.exercise),slot_id:i.slot==null?null:String(i.slot),overridden:i.overridden,prescription:prescription(i)}))}));
  const exercises=record(input.workout_exercises,'ćwiczenia sesji'),sets=record(input.sets,'serie');
  s.workouts=record(input.workouts,'sesje').map(w=>({id:w.id,profile_id:String(w.profile),plan_id:w.plan==null?null:String(w.plan),plan_name:w.plan_name,phase_name:w.phase_name,training_date:w.training_date,started_at:w.started_at,finished_at:w.finished_at,status:w.status,current_position:w.current_position,rounding_step:w.rounding_step,body_weight:w.body_weight,body_weight_date:w.body_weight_date,rest_until:null,exercises:exercises.filter(e=>String(e.workout)===w.id).sort((a,b)=>a.position-b.position).map(e=>({id:e.id,skipped:e.skipped,snapshot:{...e.snapshot,exercise_id:String(e.snapshot?.exercise_id??e.exercise),slot_id:e.snapshot?.slot_id==null?null:String(e.snapshot.slot_id)},sets:sets.filter(r=>String(r.workout_exercise)===e.id&&!r.deleted).sort((a,b)=>a.number-b.number).map((r,i)=>({id:r.id,number:i+1,weight:r.weight,reps:r.reps,seconds:r.seconds,note:r.note||''}))}))}));
  // Do not silently lose malformed, orphaned rows from a purported full export.
  if(items.length!==s.plans.reduce((n,p)=>n+p.items.length,0)||exercises.length!==s.workouts.reduce((n,w)=>n+w.exercises.length,0)||sets.filter(r=>!r.deleted).length!==s.workouts.reduce((n,w)=>n+w.exercises.reduce((m,e)=>m+e.sets.length,0),0)) throw Error('Kopia Django zawiera osierocone rekordy.');
  validateState(s);return s;
}
export async function parseBackup(raw) {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_BACKUP_BYTES) throw Error('Plik jest za duży (maks. 20 MB).');
  let input;try { input=JSON.parse(raw); } catch {throw Error('Plik nie jest poprawnym JSON.');}
  let data;
  if(input?.format==='sila-na-trase-local' && input.version===1) data=input.data;
  else if(input?.schema_version===2) data=fromDjango(input);
  else throw Error('Nieobsługiwany format lub wersja kopii.');
  validateState(data);
  if(!data.profiles.length) throw Error('Kopia nie zawiera żadnego profilu.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  return {data:clone(data),fingerprint,exported_at:input.exported_at||null,legacy:input.schema_version===2};
}
export function importBackup(target,prepared) {
  validateState(prepared.data);
  if((target.imported||[]).includes(prepared.fingerprint)) throw Error('Ten plik został już zaimportowany. Dane nie zostały powielone.');
  const source=clone(prepared.data),maps={};
  // Each import is a new, isolated set of profiles. Preserve historical values,
  // remapping references only; never recalculate historical loads from new RM.
  for(const key of ['profiles','weights','rms','exercises','phases','slots','goals','plans','workouts']) maps[key]=new Map(source[key].map(r=>[r.id,uid()]));
  const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const pick=(row,keys)=>Object.fromEntries(keys.map(k=>[k,row[k]??null]));
  // Reuse identical public definitions, so a copied profile can use its old RM
  // with newly created plans. Different conventions remain separate definitions.
  const definitionKeys={exercises:['name','mode','category','description','load_notation'],phases:['code','name','description','is_demo','source','sessions_min','sessions_max','sessions_unlimited','weekly_min','weekly_max'],slots:['phase_id','position','title','category','default_exercise_id','allowed_exercise_ids','prescription'],goals:['phase_id','exercise_id','multiplier_min','multiplier_max','target_reps','source','notes']};
  const reuse=(key,rows)=>{
    const signature=r=>stable({...pick(r,definitionKeys[key]),...(key==='slots'?{prescription:prescription(r.prescription)}:{})});
    const existing=new Map(target[key].map(r=>[signature(r),r.id]));
    source[key]=rows.filter(r=>{const id=existing.get(signature(r));if(id){maps[key].set(r._sourceId,id);return false;}delete r._sourceId;return true;});
  };
  const ref=(key,id)=>{if(id==null)return null;const out=maps[key].get(id);if(!out)throw Error('Brak powiązanego rekordu.');return out;};
  for(const r of source.profiles) { r.id=ref('profiles',r.id);r.name=r.name.slice(0,90)+' (import)'; }
  for(const r of source.exercises) {r._sourceId=r.id;r.id=ref('exercises',r.id);} reuse('exercises',source.exercises);
  for(const r of source.phases) {r._sourceId=r.id;r.id=ref('phases',r.id);} reuse('phases',source.phases);
  for(const r of source.slots) {r._sourceId=r.id;r.id=ref('slots',r.id);r.phase_id=ref('phases',r.phase_id);r.default_exercise_id=ref('exercises',r.default_exercise_id);r.allowed_exercise_ids=r.allowed_exercise_ids.map(id=>ref('exercises',id));} reuse('slots',source.slots);
  for(const r of source.goals) {r._sourceId=r.id;r.id=ref('goals',r.id);r.phase_id=ref('phases',r.phase_id);r.exercise_id=ref('exercises',r.exercise_id);} reuse('goals',source.goals);
  for(const k of ['weights','rms']) for(const r of source[k]) {r.id=ref(k,r.id);r.profile_id=ref('profiles',r.profile_id);if(k==='rms')r.exercise_id=ref('exercises',r.exercise_id);}
  for(const r of source.plans) {r.id=ref('plans',r.id);r.profile_id=ref('profiles',r.profile_id);r.phase_id=ref('phases',r.phase_id);for(const i of r.items){i.id=uid();i.exercise_id=ref('exercises',i.exercise_id);i.slot_id=ref('slots',i.slot_id);}}
  for(const w of source.workouts) {
    w.id=ref('workouts',w.id);w.profile_id=ref('profiles',w.profile_id);w.plan_id=ref('plans',w.plan_id);
    for(const e of w.exercises) {e.id=uid();e.snapshot.exercise_id=ref('exercises',e.snapshot.exercise_id);e.snapshot.slot_id=maps.slots.get(e.snapshot.slot_id)??null;for(const r of e.sets) r.id=uid();}
  }
  for(const k of Object.keys(maps)) target[k].push(...source[k]);
  target.activeProfileId=source.profiles[0].id;
  target.imported=[...(target.imported||[]),prepared.fingerprint];
  validateState(target);
  return source.profiles.length;
}
const csvCell=value=>`"${String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')}"`;
export function resultsCSV(state,profileId) {
  const rows=[['Data treningu','Plan','Faza','Status','Ćwiczenie','Seria','Ciężar kg','Powtórzenia','Czas s','Notatka']];
  for(const w of state.workouts.filter(w=>w.profile_id===profileId).sort((a,b)=>a.training_date.localeCompare(b.training_date))) for(const e of w.exercises) for(const r of e.sets) rows.push([w.training_date,w.plan_name,w.phase_name,w.status,e.snapshot.name,r.number,r.weight,r.reps,r.seconds,r.note]);
  return '\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
}
