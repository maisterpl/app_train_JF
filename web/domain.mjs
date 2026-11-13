// Domain rules are shared by the UI and Node tests. No network or storage here.
export const clone = value => structuredClone(value);
export const uid = () => crypto.randomUUID();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
export function text(value, label, max=500, required=false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw Error(`${label}: niepoprawny tekst (maks. ${max} znaków).`);
  return value.trim();
}
export function decimal(value, label='Wartość', positive=false) {
  if (typeof value !== 'string' && typeof value !== 'number') throw Error(`${label}: podaj liczbę.`);
  const input = String(value).trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(input)) throw Error(`${label}: podaj nieujemną liczbę, maksymalnie 2 miejsca po przecinku.`);
  const cents = BigInt(input.split('.')[0]) * 100n + BigInt((input.split('.')[1] || '').padEnd(2,'0'));
  if (positive && cents === 0n) throw Error(`${label}: wartość musi być dodatnia.`);
  return fromCents(cents);
}
const cents = value => {
  const s = decimal(value).split('.');
  return BigInt(s[0]) * 100n + BigInt((s[1] || '').padEnd(2,'0'));
};
const fromCents = n => `${n/100n}.${String(n%100n).padStart(2,'0')}`.replace(/\.?0+$/, '') || '0';
// Do not trim integer zeros (e.g. 100 -> 1).
export const formatNumber = value => value == null ? 'Brak danych' : new Intl.NumberFormat('pl-PL', {maximumFractionDigits:4}).format(Number(value));
export function integer(value, label='Liczba', minimum=0) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > 2147483647) throw Error(`${label}: podaj liczbę całkowitą od ${minimum}.`);
  return Number(value);
}
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw Error('Niepoprawna data.');
  return value;
}
const timestamp = value => {
  if (typeof value !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('Niepoprawna data i czas.');
  return value;
};
export const byId = (rows, id) => {
  const row = rows.find(r => r.id === id);
  if (!row) throw Error('Nie znaleziono danych.');
  return row;
};
export const activeProfile = state => state.profiles.find(p => p.id === state.activeProfileId);
export function newState(catalog) {
  return {schema_version:1, revision:0, activeProfileId:null, profiles:[], weights:[], rms:[], plans:[], workouts:[], imported:[], lastExportAt:null, ...clone(catalog)};
}
export function addProfile(s, values) {
  const row = {id:uid(), name:text(values.name,'Nazwa',100,true), notes:text(values.notes||'','Uwagi',10000), rounding_step:decimal(values.rounding_step??'2.5','Krok zaokrąglania',true)};
  s.profiles.push(row); s.activeProfileId = row.id; return row;
}
export function updateProfile(s, id, values) {
  Object.assign(byId(s.profiles,id), {name:text(values.name,'Nazwa',100,true), notes:text(values.notes||'','Uwagi',10000), rounding_step:decimal(values.rounding_step,'Krok zaokrąglania',true)});
}
export function measure(s, kind, profileId, values) {
  byId(s.profiles,profileId);
  const row = {id:uid(), profile_id:profileId, date:date(values.date), value:decimal(values.value,kind==='weights'?'Masa ciała':'1RM',true)};
  if (kind === 'rms') {
    byId(s.exercises,values.exercise_id); row.exercise_id = values.exercise_id;
    row.is_estimated = Boolean(values.is_estimated);
    if (row.is_estimated) { row.source_weight = decimal(values.source_weight,'Ciężar próby',true); row.source_reps = integer(values.source_reps,'Powtórzenia',4); if (row.source_reps>10) throw Error('Kalkulator obsługuje 4–10 powtórzeń.'); }
  } else if (kind !== 'weights') throw Error('Nieznany rodzaj pomiaru.');
  const existing = kind==='weights' && s.weights.find(r=>r.profile_id===profileId && r.date===row.date);
  if (existing) Object.assign(existing,{value:row.value}); else s[kind].push(row);
  return existing || row;
}
export function latest(rows, profileId, day, exerciseId) {
  return rows.filter(r=>r.profile_id===profileId && r.date<=day && (!exerciseId || r.exercise_id===exerciseId)).sort((a,b)=>b.date.localeCompare(a.date)||rows.indexOf(b)-rows.indexOf(a))[0];
}
export const prescriptionFields = ['sets_min','sets_max','reps_min','reps_max','seconds','percent_min','percent_max','basis','fixed_weight','tempo','rest_seconds','rest_seconds_max','notes','parameter_code','reps_original','series_load_mode','chosen_sets','middle_weight'];
export function prescription(values={}) {
  const p = {};
  for (const key of prescriptionFields) {
    const v = values[key];
    if (['percent_min','percent_max','fixed_weight','middle_weight'].includes(key)) p[key] = v==null || v==='' ? null : decimal(v,key);
    else if (['sets_min','sets_max','reps_min','reps_max','seconds','chosen_sets','rest_seconds','rest_seconds_max'].includes(key)) p[key] = v==null || v==='' ? null : integer(v,key,key.startsWith('rest') ? 0 : 1);
    else p[key] = text(v??'','Parametr',key==='notes'?10000:100);
  }
  p.series_load_mode ||= 'uniform';
  if (!['','rm','body','fixed','none'].includes(p.basis) || !['uniform','endpoints'].includes(p.series_load_mode)) throw Error('Niepoprawna podstawa obciążenia.');
  for (const [low, high] of [['sets_min','sets_max'],['reps_min','reps_max'],['percent_min','percent_max'],['rest_seconds','rest_seconds_max']]) if (p[low]!=null && p[high]!=null && Number(p[high])<Number(p[low])) throw Error('Górna granica nie może być mniejsza od dolnej.');
  if (p.series_load_mode==='endpoints' && p.chosen_sets!=null && ![2,3].includes(p.chosen_sets)) throw Error('W US wybierz 2 albo 3 serie.');
  if (p.middle_weight!=null && (p.series_load_mode!=='endpoints' || p.chosen_sets!==3)) throw Error('Środkowy ciężar dotyczy US z trzema seriami.');
  return p;
}
export function calculateLoad(values, rm=null, body=null, step='2.5') {
  const p = prescription(values);
  const out = {min:null,max:null,missing:'',explanation:''};
  const missing = message => ({...out,missing:message,explanation:message});
  if (p.series_load_mode==='endpoints') {
    if (![2,3].includes(p.chosen_sets)) return {...missing('Wybierz 2 albo 3 serie US.'),series_loads:[]};
    const rows = Array.from({length:p.chosen_sets},(_,i)=>{
      if (i===0 || i===p.chosen_sets-1) return {...calculateLoad({basis:'rm',percent_min:i===0?'60':'80'},rm,body,step),number:i+1,is_custom:false};
      return p.middle_weight==null ? {...missing('Ustal własny ciężar środkowej serii (brak danych w materiale).'),number:i+1,is_custom:true} : {...out,min:p.middle_weight,max:p.middle_weight,number:i+1,is_custom:true,explanation:`Ustawienie własne: ${p.middle_weight} kg (nie zalecenie książki).`};
    });
    return {...out,series_loads:rows,missing:rows.filter(r=>r.missing).map(r=>r.missing).join('; '),explanation:'US: pierwsza seria 60%, ostatnia 80% 1RM.'};
  }
  if (p.basis==='none') return {...out,explanation:'Bez dodatkowego obciążenia'};
  if (!['rm','body','fixed'].includes(p.basis)) return missing('Brak danych: podstawa obliczeń.');
  let low,high,prefix;
  let denominator = 1n;
  if (p.basis==='fixed') {
    if (p.fixed_weight==null) return missing('Brak danych: stały ciężar.');
    low=high=cents(p.fixed_weight); prefix='Stały ciężar';
  } else {
    const base = p.basis==='rm'?rm:body;
    if (base==null) return missing(p.basis==='rm'?'Uzupełnij 1RM tego ćwiczenia.':'Dodaj pomiar masy ciała na dzień treningu lub wcześniejszy.');
    decimal(base,'Podstawa',true);
    if (p.percent_min==null) return missing('Brak danych: procent obciążenia.');
    low=cents(base)*cents(p.percent_min); high=cents(base)*cents(p.percent_max??p.percent_min); denominator=10000n;
    prefix=`${formatNumber(p.percent_min)}${p.percent_max!=null && p.percent_max!==p.percent_min?'–'+formatNumber(p.percent_max):''}% × ${formatNumber(base)} kg ${p.basis==='rm'?'1RM':'masy ciała'}`;
  }
  const rounding = cents(decimal(step,'Krok',true));
  const rounded = n => fromCents(((2n*n+denominator*rounding)/(2n*denominator*rounding))*rounding);
  return {...out,min:rounded(low),max:rounded(high),explanation:`${prefix} = ${formatNumber(rounded(low))}${rounded(low)!==rounded(high)?'–'+formatNumber(rounded(high)):''} kg (krok ${formatNumber(step)} kg)`};
}
export function estimateRM(weight, reps) {
  const coefficients = {4:900n,5:875n,6:850n,7:825n,8:800n,9:775n,10:750n};
  const c = coefficients[integer(reps,'Powtórzenia')];
  if (!c) throw Error('Kalkulator obsługuje wyłącznie 4–10 powtórzeń.');
  return decimal(fromCents((cents(decimal(weight,'Ciężar',true))*2000n+c)/(2n*c)),'Szacowany 1RM',true);
}
export function calculateGoal(goal, body) {
  if (!goal) return 'Brak danych: cel dla tego wariantu wymaga uzupełnienia tabeli 13.3.';
  const range = `${goal.multiplier_min}–${goal.multiplier_max} × masa ciała na ${goal.target_reps} powtórzeń pod koniec fazy.`;
  return `${range} ${body==null?'Dodaj pomiar masy ciała.':`Dla ${formatNumber(body)} kg: ${formatNumber(Number(body)*Number(goal.multiplier_min))}–${formatNumber(Number(body)*Number(goal.multiplier_max))} kg.`} To cel końcowy, nie ciężar pierwszego treningu. ${goal.notes||''}`;
}
export const isCustomPlan = plan => plan.kind==='custom';
export function planPhase(s,plan) {
  return isCustomPlan(plan)?{code:'CUSTOM',name:'Plan własny',description:'Ćwiczenia i parametry wybrane przez użytkownika.',source:'Ustawienia własne użytkownika.'}:byId(s.phases,plan.phase_id);
}
export function addExercise(s,values) {
  const name=text(values.name,'Nazwa ćwiczenia',160,true);
  const key=value=>value.normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase('pl');
  if(s.exercises.some(e=>key(e.name)===key(name))) throw Error('Ćwiczenie o tej nazwie jest już w bazie. Wybierz je z listy lub podaj inną nazwę.');
  if(!['reps','time'].includes(values.mode)) throw Error('Wybierz sposób rejestrowania: powtórzenia albo czas.');
  const ex={id:uid(),name,mode:values.mode,category:text(values.category||'','Kategoria',100),description:text(values.description||'','Opis i technika',20000),load_notation:text(values.load_notation||'','Sposób zapisu ciężaru',20000,true),is_custom:true};
  s.exercises.push(ex);return ex;
}
export function createCustomPlan(s,profileId,values) {
  byId(s.profiles,profileId);
  const plan={id:uid(),profile_id:profileId,name:text(values.name,'Nazwa planu',160,true),kind:'custom',phase_id:null,items:[]};
  s.plans.push(plan);return plan;
}
function checkCustomPrescription(p,exercise) {
  if(p.sets_min==null) throw Error('Podaj proponowaną liczbę serii.');
  if(exercise.mode==='time') {
    if(p.seconds==null) throw Error('Podaj proponowany czas ćwiczenia w sekundach.');
    if(p.reps_min!=null||p.reps_max!=null) throw Error('Ćwiczenie na czas nie może mieć zalecanych powtórzeń.');
  } else {
    if(p.reps_min==null) throw Error('Podaj proponowaną liczbę powtórzeń.');
    if(p.seconds!=null) throw Error('Ćwiczenie na powtórzenia nie może mieć zalecanego czasu.');
  }
  if(p.rest_seconds==null) throw Error('Podaj czas odpoczynku (0 oznacza brak przerwy).');
  if(!['rm','body','fixed','none'].includes(p.basis)) throw Error('Wybierz podstawę obciążenia.');
  if(['rm','body'].includes(p.basis)&&p.percent_min==null) throw Error('Podaj procent wybranej podstawy obciążenia.');
  if(p.basis==='fixed'&&p.fixed_weight==null) throw Error('Podaj stały ciężar.');
  if(p.series_load_mode!=='uniform'||p.parameter_code||p.reps_original||p.chosen_sets!=null||p.middle_weight!=null) throw Error('Własny plan wymaga własnych parametrów, bez zaleceń fazy.');
}
function customPrescription(exercise,values) {
  const p=prescription({...values,series_load_mode:'uniform',parameter_code:'',reps_original:'',chosen_sets:null,middle_weight:null,
    reps_min:exercise.mode==='time'?null:values.reps_min,reps_max:exercise.mode==='time'?null:values.reps_max,seconds:exercise.mode==='time'?values.seconds:null,
    percent_min:['rm','body'].includes(values.basis)?values.percent_min:null,percent_max:['rm','body'].includes(values.basis)?values.percent_max:null,fixed_weight:values.basis==='fixed'?values.fixed_weight:null});
  checkCustomPrescription(p,exercise);return p;
}
export function addCustomPlanItem(s,planId,values) {
  const plan=byId(s.plans,planId);if(!isCustomPlan(plan)) throw Error('Dodawanie dowolnych ćwiczeń jest dostępne we własnym planie.');
  const exercise=byId(s.exercises,values.exercise_id),p=customPrescription(exercise,values);
  const item={id:uid(),slot_id:null,exercise_id:exercise.id,prescription:p,overridden:true};
  plan.items.push(item);return item;
}
export function deletePlan(s,planId) {
  byId(s.plans,planId);
  s.plans=s.plans.filter(p=>p.id!==planId);
  // Session snapshots and results outlive their reusable source plan.
  for(const w of s.workouts) if(w.plan_id===planId) w.plan_id=null;
}
export function createPlan(s, profileId, values) {
  byId(s.profiles,profileId); byId(s.phases,values.phase_id);
  const plan = {id:uid(),profile_id:profileId,name:text(values.name,'Nazwa planu',160,true),phase_id:values.phase_id,items:[]};
  s.plans.push(plan); return plan;
}
export function checkPlan(s, plan) {
  if(plan.kind!=null&&!isCustomPlan(plan)) throw Error('Nieobsługiwany rodzaj planu.');
  if(isCustomPlan(plan)&&plan.phase_id!=null) throw Error('Własny plan nie jest przypisany do fazy.');
  const phase = planPhase(s,plan), hips = new Set(), slots = new Set();
  for (const item of plan.items) {
    const exercise=byId(s.exercises,item.exercise_id),p=prescription(item.prescription);
    if(isCustomPlan(plan)) {
      if(item.slot_id!=null) throw Error('Własny plan nie może zmieniać pozycji fazy.');
      checkCustomPrescription(p,exercise);
    }
    if (item.slot_id) {
      const slot = byId(s.slots,item.slot_id);
      if (slot.phase_id!==plan.phase_id || !slot.allowed_exercise_ids.includes(item.exercise_id) || slots.has(slot.id)) throw Error('Niepoprawny wariant lub powtórzona pozycja fazy.');
      slots.add(slot.id);
      if (phase.code==='AA' && slot.category==='hip') {
        if (hips.has(item.exercise_id)) throw Error('W AA wybierz dwa różne warianty wyprostu biodra.');
        hips.add(item.exercise_id);
      }
    }
  }
}
export function addPlanItems(s, planId, choices) {
  const plan=byId(s.plans,planId);
  if(isCustomPlan(plan)) throw Error('Wybierz własne parametry ćwiczenia.');
  for (const choice of choices) {
    const slot=byId(s.slots,choice.slot_id);
    const p=prescription({...slot.prescription,chosen_sets:choice.chosen_sets??slot.prescription.chosen_sets});
    plan.items.push({id:uid(),slot_id:slot.id,exercise_id:choice.exercise_id,prescription:p,overridden:false});
  }
  checkPlan(s,plan);
}
export function updateItem(s, planId, itemId, values) {
  const plan=byId(s.plans,planId), item=byId(plan.items,itemId);
  const p=isCustomPlan(plan)?customPrescription(byId(s.exercises,values.exercise_id),values):prescription(values);
  item.exercise_id=values.exercise_id; item.prescription=p; item.overridden=true;
  // Original source text must not conceal a user's altered repetition range.
  if (String(values.reps_min??'')!==String(values.original_reps_min??item.prescription.reps_min) || values.clear_original) item.prescription.reps_original='';
  checkPlan(s,plan);
}
export function moveItem(s,planId,itemId,delta) {
  const items=byId(s.plans,planId).items, index=items.findIndex(i=>i.id===itemId);
  if (index<0) throw Error('Brak pozycji.');
  if (index+delta>=0 && index+delta<items.length) [items[index],items[index+delta]]=[items[index+delta],items[index]];
}
export function startWorkout(s,planId,day=today(),id=uid()) {
  const existing=s.workouts.find(w=>w.id===id);
  if (existing) { if (existing.plan_id!==planId) throw Error('Identyfikator już używany.'); return existing; }
  const plan=byId(s.plans,planId), profile=byId(s.profiles,plan.profile_id), phase=planPhase(s,plan);
  date(day); checkPlan(s,plan);
  if (!plan.items.length) throw Error('Dodaj co najmniej jedno ćwiczenie.');
  const body=latest(s.weights,profile.id,day);
  const w={id,profile_id:profile.id,plan_id:plan.id,plan_name:plan.name,phase_name:phase.name,training_date:day,started_at:new Date().toISOString(),finished_at:null,status:'active',current_position:0,body_weight:body?.value??null,body_weight_date:body?.date??null,rounding_step:profile.rounding_step,rest_until:null,exercises:[]};
  for (const item of plan.items) {
    const exercise=byId(s.exercises,item.exercise_id), rm=latest(s.rms,profile.id,day,exercise.id), p=clone(item.prescription);
    if (p.series_load_mode==='endpoints' && ![2,3].includes(p.chosen_sets)) throw Error('Przed treningiem wybierz 2 albo 3 serie US.');
    const previous=s.workouts.filter(x=>x.profile_id===profile.id && x.status==='completed' && x.training_date<=day && x.exercises.some(e=>e.snapshot.exercise_id===exercise.id && e.sets.length)).sort((a,b)=>b.training_date.localeCompare(a.training_date)||b.started_at.localeCompare(a.started_at))[0];
    const previous_results=previous?previous.exercises.filter(e=>e.snapshot.exercise_id===exercise.id).flatMap(e=>e.sets.map(r=>({...clone(r),date:previous.training_date}))):[];
    const goal=s.goals.find(g=>g.phase_id===phase.id && g.exercise_id===exercise.id);
    const load=calculateLoad(p,rm?.value,body?.value,profile.rounding_step);
    w.exercises.push({id:uid(),skipped:false,sets:[],snapshot:{...p,...clone(exercise),id:undefined,exercise_id:exercise.id,phase_code:phase.code,slot_id:item.slot_id,overridden:item.overridden,rm:rm?.value??null,rm_date:rm?.date??null,rm_is_estimated:rm?.is_estimated??false,body_weight:body?.value??null,body_weight_date:body?.date??null,load,end_goal:p.parameter_code==='SM'?calculateGoal(goal,body?.value):null,previous_results}});
  }
  s.workouts.push(w); return w;
}
function activeWorkout(s,id) { const w=byId(s.workouts,id); if(w.status!=='active') throw Error('Trening jest zakończony. Nie można zmieniać serii.'); return w; }
export function saveSet(s,workoutId,exerciseId,values) {
  const w=activeWorkout(s,workoutId), ex=byId(w.exercises,exerciseId), id=values.id||uid();
  const existing=ex.sets.find(r=>r.id===id);
  if (s.workouts.some(x=>x.exercises.some(e=>e.id!==ex.id && e.sets.some(r=>r.id===id)))) throw Error('Identyfikator serii już używany.');
  const row={id,number:existing?.number??ex.sets.length+1,weight:decimal(values.weight,'Ciężar'),reps:ex.snapshot.mode==='time'?null:integer(values.reps,'Powtórzenia'),seconds:ex.snapshot.mode==='time'?integer(values.seconds,'Czas'):null,note:text(values.note||'','Notatka',500)};
  if(existing) Object.assign(existing,row); else ex.sets.push(row);
  ex.skipped=false; w.rest_until=Date.now()+Number(ex.snapshot.rest_seconds||0)*1000;
  return row;
}
export function removeSet(s,workoutId,exerciseId,setId) {
  const ex=byId(activeWorkout(s,workoutId).exercises,exerciseId); byId(ex.sets,setId);
  ex.sets=ex.sets.filter(r=>r.id!==setId); ex.sets.forEach((r,i)=>r.number=i+1);
}
export function navigate(s,id,position) {
  const w=activeWorkout(s,id); integer(position,'Pozycja');
  if(position>=w.exercises.length) throw Error('Niepoprawna pozycja.'); w.current_position=position;
}
export function skip(s,id,exerciseId) { const w=activeWorkout(s,id); byId(w.exercises,exerciseId).skipped=true; w.current_position=Math.min(w.exercises.length-1,w.current_position+1); }
export function finish(s,id,at=new Date().toISOString()) {
  const w=activeWorkout(s,id); timestamp(at);
  if(Date.parse(at)<Date.parse(w.started_at) || Date.parse(at)>Date.now()+300000) throw Error('Niepoprawny czas zakończenia.');
  w.status='completed'; w.finished_at=at; w.rest_until=null;
}
export function exerciseProgress(s,profileId,exerciseId) {
  const exercise=byId(s.exercises,exerciseId), time=exercise.mode==='time';
  return s.workouts.filter(w=>w.profile_id===profileId && w.status==='completed').sort((a,b)=>a.training_date.localeCompare(b.training_date)||a.started_at.localeCompare(b.started_at)).flatMap(w=>{
    const rows=w.exercises.filter(e=>e.snapshot.exercise_id===exerciseId && e.snapshot.mode===exercise.mode).flatMap(e=>e.sets).filter(r=>time?r.seconds!=null:r.reps!=null);
    rows.sort((a,b)=>time?b.seconds-a.seconds:Number(b.weight)-Number(a.weight)||(b.reps??0)-(a.reps??0));
    return rows.length?[{workout_id:w.id,date:w.training_date,started_at:w.started_at,value:Number(time?rows[0].seconds:rows[0].weight),reps:rows[0].reps,seconds:rows[0].seconds}]:[];
  });
}
export function seedDemo(s) {
  const profile=addProfile(s,{name:'Kolarz DEMO',notes:'Przykładowe dane do sprawdzenia działania; nie są zaleceniami Joe Friela.'});
  measure(s,'weights',profile.id,{date:today(),value:'80'});
  measure(s,'rms',profile.id,{date:today(),exercise_id:'demo-ex-1',value:'100'});
  const plan=createPlan(s,profile.id,{name:'DEMO — trening kolarza',phase_id:'DEMO'});
  addPlanItems(s,plan.id,s.slots.filter(r=>r.phase_id==='DEMO').map(r=>({slot_id:r.id,exercise_id:r.default_exercise_id})));
  return profile;
}

// Validate untrusted backups before they can reach IndexedDB. Limits bound work
// and all references are checked, including nested historical snapshots.
export function validateState(s) {
  if (!s || s.schema_version!==1) throw Error('Nieobsługiwana wersja kopii danych.');
  const keys=['profiles','weights','rms','exercises','phases','slots','goals','plans','workouts'];
  const globalIds=new Set();
  function rows(list,limit=50000) {
    if(!Array.isArray(list)||list.length>limit) throw Error('Niepoprawna lub zbyt duża lista danych.');
    const ids=new Set();
    for(const r of list) { if(!r||typeof r!=='object'||typeof r.id!=='string'||!r.id.length||r.id.length>160||ids.has(r.id)) throw Error('Niepoprawny lub powtórzony identyfikator.'); ids.add(r.id); }
  }
  for(const k of keys) rows(s[k]);
  for(const p of s.profiles) { text(p.name,'Profil',100,true);text(p.notes||'','Uwagi',10000);decimal(p.rounding_step,'Krok',true); }
  if(s.activeProfileId!=null) byId(s.profiles,s.activeProfileId);
  for(const ex of s.exercises) { text(ex.name,'Ćwiczenie',160,true); if(!['reps','time'].includes(ex.mode)) throw Error('Niepoprawny tryb ćwiczenia.'); text(ex.description||'','Opis',20000);text(ex.category||'','Kategoria',100);text(ex.load_notation||'','Obciążenie',20000); }
  for(const ph of s.phases) { text(ph.name,'Faza',160,true);text(ph.description||'','Opis',20000);text(ph.source||'','Źródło',20000); }
  for(const slot of s.slots) { byId(s.phases,slot.phase_id);byId(s.exercises,slot.default_exercise_id);integer(slot.position,'Pozycja',1);text(slot.title,'Pozycja',160,true);if(!Array.isArray(slot.allowed_exercise_ids)||!slot.allowed_exercise_ids.length||slot.allowed_exercise_ids.length>1000) throw Error('Brak wariantów.'); for(const id of slot.allowed_exercise_ids) byId(s.exercises,id); if(!slot.allowed_exercise_ids.includes(slot.default_exercise_id)) throw Error('Brak domyślnego wariantu.');prescription(slot.prescription); }
  for(const goal of s.goals) { byId(s.phases,goal.phase_id);byId(s.exercises,goal.exercise_id);decimal(goal.multiplier_min,'Mnożnik',true);decimal(goal.multiplier_max,'Mnożnik',true);if(Number(goal.multiplier_max)<Number(goal.multiplier_min)) throw Error('Niepoprawny zakres celu.');integer(goal.target_reps,'Powtórzenia',1); }
  for(const kind of ['weights','rms']) for(const r of s[kind]) { byId(s.profiles,r.profile_id);date(r.date);decimal(r.value,'Pomiar',true);if(kind==='rms') { byId(s.exercises,r.exercise_id);if(r.source_weight!=null) decimal(r.source_weight,'Ciężar próby',true);if(r.source_reps!=null) integer(r.source_reps,'Powtórzenia próby',1); } }
  for(const p of s.plans) { byId(s.profiles,p.profile_id);text(p.name,'Plan',160,true);rows(p.items,1000);checkPlan(s,p); }
  for(const w of s.workouts) {
    byId(s.profiles,w.profile_id);if(w.plan_id!=null && byId(s.plans,w.plan_id).profile_id!==w.profile_id) throw Error('Plan innego profilu.');
    text(w.plan_name,'Nazwa planu',160,true);text(w.phase_name,'Faza',160,true);date(w.training_date);timestamp(w.started_at);decimal(w.rounding_step,'Krok',true);
    if(!['active','completed'].includes(w.status)) throw Error('Niepoprawny status.');
    if(w.status==='completed') {timestamp(w.finished_at);if(Date.parse(w.finished_at)<Date.parse(w.started_at)) throw Error('Zakończenie przed rozpoczęciem.');}
    else if(w.finished_at!=null) throw Error('Aktywny trening ma datę zakończenia.');
    if(w.body_weight!=null) decimal(w.body_weight,'Masa',true);if(w.body_weight_date!=null) date(w.body_weight_date);
    rows(w.exercises,1000);integer(w.current_position,'Pozycja');if(!w.exercises.length||w.current_position>=w.exercises.length) throw Error('Niepoprawne ćwiczenie treningu.');
    for(const ex of w.exercises) {
      if(globalIds.has(ex.id)) throw Error('Powtórzone ćwiczenie sesji.');globalIds.add(ex.id);
      const snap=ex.snapshot;if(!snap||typeof snap!=='object') throw Error('Brak kopii parametrów.');
      byId(s.exercises,snap.exercise_id);text(snap.name,'Ćwiczenie',160,true);if(!['reps','time'].includes(snap.mode)) throw Error('Niepoprawny tryb kopii.');prescription(snap);
      if(snap.rm!=null) decimal(snap.rm,'1RM',true);if(snap.body_weight!=null) decimal(snap.body_weight,'Masa',true);
      for(const k of ['rm_date','body_weight_date']) if(snap[k]!=null) date(snap[k]);
      if(!snap.load||typeof snap.load!=='object') throw Error('Brak obliczeń w kopii.');
      for(const k of ['min','max']) if(snap.load[k]!=null) decimal(snap.load[k],'Ciężar');
      if(snap.load.series_loads!=null) {if(!Array.isArray(snap.load.series_loads)||snap.load.series_loads.length>3) throw Error('Niepoprawne serie US.');for(const r of snap.load.series_loads) for(const k of ['min','max']) if(r[k]!=null) decimal(r[k],'Ciężar US');}
      if(snap.previous_results!=null) {if(!Array.isArray(snap.previous_results)||snap.previous_results.length>50000) throw Error('Niepoprawna historia.');for(const r of snap.previous_results) {date(r.date);decimal(r.weight,'Ciężar');if(r.reps!=null) integer(r.reps);if(r.seconds!=null) integer(r.seconds);}}
      rows(ex.sets,10000);
      for(const [index,r] of ex.sets.entries()) { if(globalIds.has(r.id)) throw Error('Powtórzona seria.');globalIds.add(r.id);if(r.number!==index+1) throw Error('Niepoprawna numeracja serii.');decimal(r.weight,'Ciężar');text(r.note||'','Notatka',500);if(snap.mode==='time') {integer(r.seconds,'Czas');if(r.reps!=null) throw Error('Powtórzenia w ćwiczeniu na czas.');}else {integer(r.reps,'Powtórzenia');if(r.seconds!=null) throw Error('Czas w ćwiczeniu na powtórzenia.');} }
    }
  }
  return s;
}
