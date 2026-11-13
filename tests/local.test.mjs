import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../web/domain.mjs';
import * as B from '../web/backup.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../web/catalog.json',import.meta.url)));
function demo(){const s=D.newState(catalog);D.seedDemo(s);return s;}
function session(s=demo()){const w=D.startWorkout(s,s.plans[0].id);return {s,w,ex:w.exercises[0]};}
const save=(s,w,ex,values={})=>D.saveSet(s,w.id,ex.id,{id:D.uid(),weight:'60',reps:8,note:'',...values});

test('1RM percentages use 1RM, decimal calculations do not drift',()=>{
  const r=D.calculateLoad({basis:'rm',percent_min:'60'},'100','80','2.5');assert.equal(r.min,'60');assert.match(r.explanation,/60% × 100 kg 1RM/);
  assert.equal(D.calculateLoad({basis:'rm',percent_min:'33.33'},'99.99',null,'0.01').min,'33.33');
});
test('body percentages use body weight, not RM',()=>{const r=D.calculateLoad({basis:'body',percent_min:20},'100','80','1');assert.equal(r.min,'16');assert.match(r.explanation,/masy ciała/);});
test('range and ROUND_HALF_UP for supported steps',()=>{
  assert.deepEqual(((r)=>[r.min,r.max])(D.calculateLoad({basis:'rm',percent_min:'40',percent_max:'60'},'103',null,'2.5')),['40','62.5']);
  for(const step of ['0.5','1','2.5','5'])assert.equal(D.calculateLoad({basis:'fixed',fixed_weight:Number(step)/2},null,null,step).min,step);
});
test('unknown inputs are not replaced with zero; fixed zero is valid',()=>{
  assert.match(D.calculateLoad({basis:'rm',percent_min:50},null,'80').missing,/1RM/);
  assert.match(D.calculateLoad({basis:'body',percent_min:50},'100',null).missing,/masy ciała/);
  assert.match(D.calculateLoad({basis:'rm'},'100').missing,/procent/);
  assert.equal(D.calculateLoad({basis:'fixed',fixed_weight:0}).min,'0');
  assert.equal(D.calculateLoad({basis:'none'}).min,null);
});
test('reject negatives, NaN, Infinity, empty, excessive precision and reversed ranges',()=>{
  for(const v of [-1,'',null,NaN,Infinity,'1.234','1e3',true])assert.throws(()=>D.decimal(v));
  assert.equal(D.decimal('78,50'),'78.5');assert.equal(D.decimal('100'),'100');
  assert.throws(()=>D.calculateLoad({basis:'rm',percent_min:60,percent_max:40},'100'));
  assert.throws(()=>D.calculateLoad({basis:'fixed',fixed_weight:5},null,null,'0'));
});
test('US endpoints: never invent a middle percentage',()=>{
  const r=D.calculateLoad({basis:'rm',series_load_mode:'endpoints',chosen_sets:3},'100');
  assert.deepEqual(r.series_loads.map(r=>r.min),['60',null,'80']);assert.match(r.series_loads[1].missing,/własny/);
  assert.equal(D.calculateLoad({basis:'rm',series_load_mode:'endpoints',chosen_sets:3,middle_weight:'67'},'100').series_loads[1].min,'67');
  assert.equal(D.calculateLoad({series_load_mode:'endpoints'}).series_loads.length,0);
});
test('source catalog has all five phases and exact helper/source limitations',()=>{
  assert.deepEqual(catalog.phases.filter(p=>!p.is_demo).map(p=>p.code),['AA','SM','WM','WS','US']);
  assert.equal(catalog.slots.filter(s=>s.phase_id==='AA').length,8);
  assert.equal(catalog.slots.filter(s=>s.phase_id==='US').length,6);
  assert.equal(catalog.slots.find(s=>s.id==='SM-3').prescription.basis,'');
  assert.equal(catalog.slots.find(s=>s.id==='WM-4').prescription.parameter_code,'AA');
  assert.equal(D.validateState(D.newState(catalog)).profiles.length,0);
});
test('SM goal separate from session starting load, no borrowed goal for leg press',()=>{
  const goal=catalog.goals.find(g=>g.exercise_id==='friel-ex-1');
  assert.match(D.calculateGoal(goal,'80'),/104–136 kg/);
  assert.match(D.calculateGoal(null,'80'),/Brak danych/);
  assert.match(D.calculateLoad(catalog.slots.find(s=>s.id==='SM-1').prescription,'100','80').missing,/podstawa/);
});
test('1RM estimate from table requires 4–10 reps; sets never update RM',()=>{
  assert.equal(D.estimateRM('85',6),'100');assert.throws(()=>D.estimateRM('50',3));
  const {s,w,ex}=session(),before=D.clone(s.rms);save(s,w,ex);assert.deepEqual(s.rms,before);
});
test('select only requested slots, order can move up/down without adding exercises',()=>{
  const s=demo(),p=D.createPlan(s,s.activeProfileId,{name:'AA',phase_id:'AA'});
  D.addPlanItems(s,p.id,[{slot_id:'AA-1',exercise_id:'friel-ex-1'},{slot_id:'AA-2',exercise_id:'friel-ex-5'}]);
  assert.equal(p.items.length,2);const id=p.items[1].id;D.moveItem(s,p.id,id,-1);assert.equal(p.items[0].id,id);D.moveItem(s,p.id,id,-1);assert.equal(p.items[0].id,id);
});
test('AA prevents duplicate hip variants; US requires explicit set count before start',()=>{
  const s=demo(),p=D.createPlan(s,s.activeProfileId,{name:'AA',phase_id:'AA'});
  assert.throws(()=>D.addPlanItems(s,p.id,[{slot_id:'AA-1',exercise_id:'friel-ex-1'},{slot_id:'AA-3',exercise_id:'friel-ex-1'}]),/różne/);
  const t=demo(),us=D.createPlan(t,t.activeProfileId,{name:'US',phase_id:'US'});D.addPlanItems(t,us.id,[{slot_id:'US-1',exercise_id:'friel-ex-1'}]);assert.throws(()=>D.startWorkout(t,us.id),/2 albo 3/);
});
test('body and RM measurements selected as of training date, same-day RM latest insertion',()=>{
  const s=demo(),p=s.profiles[0],ex=s.plans[0].items[0].exercise_id;
  D.measure(s,'weights',p.id,{date:'2025-01-01',value:70});D.measure(s,'weights',p.id,{date:'2025-02-01',value:90});
  D.measure(s,'rms',p.id,{exercise_id:ex,date:'2025-01-01',value:120});D.measure(s,'rms',p.id,{exercise_id:ex,date:'2025-01-01',value:130});
  const w=D.startWorkout(s,s.plans[0].id,'2025-01-15');assert.equal(w.body_weight,'70');assert.equal(w.exercises[0].snapshot.rm,'130');
  const early=D.startWorkout(s,s.plans[0].id,'2024-01-01');assert.equal(early.body_weight,null);assert.equal(early.exercises[0].snapshot.rm,null);
});
test('snapshot survives later changes to plan, RM, body mass and profile rounding',()=>{
  const {s,w}=session(),before=D.clone(w);s.plans[0].items[0].prescription.percent_min='5';s.rms[0].value='999';s.weights[0].value='99';s.profiles[0].rounding_step='5';
  assert.deepEqual(w,before);
});
test('UUID set saves are idempotent; numbers independent and renumbered on delete',()=>{
  const {s,w,ex}=session(),id=D.uid();save(s,w,ex,{id});save(s,w,ex,{id,weight:'61'});assert.equal(ex.sets.length,1);assert.equal(ex.sets[0].weight,'61');
  save(s,w,ex);const second=w.exercises[1];save(s,w,second);assert.equal(second.sets[0].number,1);D.removeSet(s,w.id,ex.id,id);assert.equal(ex.sets[0].number,1);
});
test('validation rejects negative sets and mismatched values for time exercises',()=>{
  const {s,w,ex}=session();assert.throws(()=>save(s,w,ex,{weight:-1}));assert.throws(()=>save(s,w,ex,{reps:-1}));assert.throws(()=>save(s,w,ex,{reps:1.5}));
  const time=w.exercises[2];save(s,w,time,{seconds:40});assert.equal(time.sets[0].reps,null);assert.equal(time.sets[0].seconds,40);assert.throws(()=>save(s,w,time,{seconds:-5}));
});
test('navigate, skip, resume and finish preserve sets; finished session rejects all mutations',()=>{
  const {s,w,ex}=session();save(s,w,ex);D.navigate(s,w.id,1);D.skip(s,w.id,w.exercises[1].id);assert.equal(w.current_position,2);D.navigate(s,w.id,0);assert.equal(ex.sets.length,1);
  assert.equal(D.startWorkout(s,s.plans[0].id,undefined,w.id).id,w.id);assert.equal(s.workouts.length,1);
  D.finish(s,w.id);assert.throws(()=>save(s,w,ex),/zakończony/);assert.throws(()=>D.removeSet(s,w.id,ex.id,ex.sets[0].id));assert.throws(()=>D.navigate(s,w.id,1));assert.throws(()=>D.finish(s,w.id));
});
test('progress excludes active sessions and other profiles; greatest weight with reps context',()=>{
  const {s,w,ex}=session();save(s,w,ex,{weight:60,reps:6});save(s,w,ex,{weight:60,reps:8});save(s,w,ex,{weight:55,reps:12});
  assert.equal(D.exerciseProgress(s,w.profile_id,ex.snapshot.exercise_id).length,0);D.finish(s,w.id);
  const p=D.addProfile(s,{name:'Other'});assert.equal(D.exerciseProgress(s,p.id,ex.snapshot.exercise_id).length,0);
  const points=D.exerciseProgress(s,w.profile_id,ex.snapshot.exercise_id);assert.equal(points[0].value,60);assert.equal(points[0].reps,8);
});
test('timed progress uses seconds and keeps zero results',()=>{const {s,w}=session(),ex=w.exercises[2];save(s,w,ex,{seconds:0});save(s,w,ex,{seconds:45});D.finish(s,w.id);assert.equal(D.exerciseProgress(s,w.profile_id,ex.snapshot.exercise_id)[0].value,45);});
test('manual measurements and profiles are independent',()=>{const s=demo(),other=D.addProfile(s,{name:'Other'});assert.equal(D.latest(s.weights,other.id,D.today()),undefined);assert.equal(D.latest(s.rms,other.id,D.today(),'demo-ex-1'),undefined);});
test('native backup roundtrip keeps values/history and imports into new profiles',async()=>{
  const {s,w,ex}=session();save(s,w,ex);D.finish(s,w.id);
  const raw=JSON.stringify(B.makeBackup(s)),parsed=await B.parseBackup(raw),target=demo(),original=D.clone(target.profiles[0]);
  assert.equal(B.importBackup(target,parsed),1);assert.equal(target.profiles.length,2);assert.deepEqual(target.profiles[0],original);assert.notEqual(target.workouts[0].id,w.id);assert.equal(target.workouts[0].exercises[0].sets[0].weight,'60');assert.equal(target.exercises.length,catalog.exercises.length);
  assert.equal(target.workouts[0].exercises[0].snapshot.rm,'100');D.validateState(target);
  assert.throws(()=>B.importBackup(target,parsed),/już zaimportowany/);
});
test('export active profile contains no other profiles or results',()=>{const s=demo(),first=s.activeProfileId;D.seedDemo(s);const backup=B.makeBackup(s,first);assert.equal(backup.data.profiles.length,1);assert(backup.data.weights.every(w=>w.profile_id===first));assert.equal(backup.data.plans.length,1);D.validateState(backup.data);});
test('malformed/oversized/unknown-version backup is rejected',async()=>{
  for(const text of ['not json','null','{"format":"sila-na-trase-local","version":99}',JSON.stringify({format:'sila-na-trase-local',version:1,data:{schema_version:1}})])await assert.rejects(()=>B.parseBackup(text));
  await assert.rejects(()=>B.parseBackup(' '.repeat(B.MAX_BACKUP_BYTES+1)),/duży/);
});
test('negative numbers, bad dates, foreign references and duplicate set UUID in backup rejected',async()=>{
  const {s,w,ex}=session();save(s,w,ex);
  for(const corrupt of [x=>x.workouts[0].exercises[0].sets[0].weight='-1',x=>x.weights[0].date='2025-02-30',x=>x.plans[0].profile_id='foreign',x=>x.workouts[0].exercises[0].sets.push({...x.workouts[0].exercises[0].sets[0]})]) {const data=D.clone(s);corrupt(data);await assert.rejects(()=>B.parseBackup(JSON.stringify({format:'sila-na-trase-local',version:1,data})));}
});
test('CSV quotes notes, protects spreadsheet formulas, includes reps and time',()=>{const {s,w,ex}=session();w.plan_name='=1+1';save(s,w,ex,{note:'=SUM(A1)\n"x"'});save(s,w,w.exercises[2],{seconds:30});const csv=B.resultsCSV(s,w.profile_id);assert.match(csv,/"'=1\+1"/);assert.match(csv,/"'=SUM/);assert.match(csv,/"60";"8";""/);assert.match(csv,/"";"30"/);});

function legacyFixture() {
  const rec=(model,pk,fields)=>({model:'training.'+model,pk,fields});
  return {schema_version:2,exported_at:new Date().toISOString(),profile:[rec('profile',1,{name:'Stary profil',owner:99,notes:'',rounding_step:'2.50'})],body_weights:[rec('bodyweight',1,{profile:1,date:'2025-01-01',value:'80.00'})],one_rep_max:[rec('onerepmax',1,{profile:1,exercise:1,date:'2025-01-01',value:'100.00',is_estimated:false})],exercises:[rec('exercise',1,{name:'Przysiad',mode:'reps',category:'Nogi',description:'Opis',load_notation:'kg'})],phases:[rec('phase',1,{name:'AA stara',code:'AA',description:'Źródło',source:'Materiał',is_demo:false})],phase_slots:[rec('phaseslot',1,{phase:1,position:1,title:'Przysiad',category:'hip',default_exercise:1,allowed_exercises:[1],basis:'rm',percent_min:'60'})],strength_goals:[],recommendations:[],plans:[rec('plan',1,{profile:1,name:'Stary plan',phase:1})],plan_items:[rec('planitem',1,{plan:1,exercise:1,position:1,slot:1,basis:'rm',percent_min:'60',overridden:false})],workouts:[rec('workout','legacy-session',{profile:1,plan:1,plan_name:'Stary plan',phase_name:'AA stara',training_date:'2025-01-02',started_at:'2025-01-02T10:00:00Z',finished_at:'2025-01-02T11:00:00Z',status:'completed',current_position:0,body_weight:'80.00',body_weight_date:'2025-01-01',rounding_step:'2.50'})],workout_exercises:[rec('workoutexercise','legacy-ex',{workout:'legacy-session',exercise:1,position:1,skipped:false,snapshot:{name:'Przysiad',exercise_id:1,slot_id:1,mode:'reps',basis:'rm',percent_min:'60',rm:'100',body_weight:'80',load:{min:'60',max:'60',explanation:'60% × 100 kg 1RM = 60 kg'},previous_results:[]}})],sets:[rec('workoutset','legacy-set',{workout_exercise:'legacy-ex',number:1,weight:'60.00',reps:8,seconds:null,note:'Import',deleted:false})]};
}
test('Django schema 2 import preserves full session and source definitions, drops account ownership',async()=>{
  const parsed=await B.parseBackup(JSON.stringify(legacyFixture())),target=demo();assert(parsed.legacy);B.importBackup(target,parsed);const imported=target.profiles.at(-1);assert.equal(imported.owner,undefined);assert.equal(imported.name,'Stary profil (import)');assert.equal(target.workouts[0].exercises[0].sets[0].reps,8);assert.equal(target.workouts[0].exercises[0].snapshot.rm,'100');D.validateState(target);
});
test('Django importer rejects orphaned rows instead of silently discarding them',async()=>{const legacy=legacyFixture();legacy.plan_items[0].fields.plan=999;await assert.rejects(()=>B.parseBackup(JSON.stringify(legacy)),/osierocone/);});
test('imported RM remains usable with a newly created plan from same catalog',async()=>{const source=demo(),target=D.newState(catalog);B.importBackup(target,await B.parseBackup(JSON.stringify(B.makeBackup(source))));const p=D.createPlan(target,target.activeProfileId,{name:'Nowy',phase_id:'DEMO'});D.addPlanItems(target,p.id,[{slot_id:'DEMO-1',exercise_id:'demo-ex-1'}]);const w=D.startWorkout(target,p.id);assert.equal(w.exercises[0].snapshot.rm,'100');});

const ownValues=(exerciseId,extra={})=>({exercise_id:exerciseId,sets_min:3,reps_min:10,rest_seconds:90,basis:'rm',percent_min:'60',notes:'Kontroluj ruch',...extra});
test('own exercise validates name/mode/convention and cannot replace existing definitions',()=>{
  const s=demo(),before=D.clone(s.exercises);
  const ex=D.addExercise(s,{name:'Wyciskanie hantli',category:'Barki',mode:'reps',description:'Kontrolowany ruch.',load_notation:'Ciężar jednego hantla w kg'});
  assert(ex.is_custom);assert.equal(ex.load_notation,'Ciężar jednego hantla w kg');assert.deepEqual(s.exercises.slice(0,-1),before);
  for(const values of [{name:'',mode:'reps',load_notation:'kg'},{name:'Inne',mode:'invalid',load_notation:'kg'},{name:'Inne',mode:'time',load_notation:''},{name:' wyciskanie HANTLI ',mode:'reps',load_notation:'kg'}])assert.throws(()=>D.addExercise(s,values));
});
test('own plan uses the exercise library without changing source phases or existing plans',()=>{
  const s=demo(),before=D.clone({phases:s.phases,slots:s.slots,plans:s.plans});
  const plan=D.createCustomPlan(s,s.activeProfileId,{name:'Mój plan'});D.addCustomPlanItem(s,plan.id,ownValues('friel-ex-1'));
  assert.equal(plan.phase_id,null);assert.equal(D.planPhase(s,plan).name,'Plan własny');assert.equal(plan.items[0].slot_id,null);assert.equal(plan.items[0].prescription.notes,'Kontroluj ruch');
  assert.deepEqual(s.phases,before.phases);assert.deepEqual(s.slots,before.slots);assert.deepEqual(s.plans[0],before.plans[0]);D.validateState(s);
  assert.throws(()=>D.addCustomPlanItem(s,s.plans[0].id,ownValues('friel-ex-1')),/własnym planie/);
});
test('own plan validates required series/reps/rest/load percentage and ranges',()=>{
  const s=demo(),p=D.createCustomPlan(s,s.activeProfileId,{name:'Mój'});
  for(const bad of [{sets_min:0},{reps_min:''},{rest_seconds:''},{rest_seconds:-1},{percent_min:''},{basis:''},{basis:'fixed',fixed_weight:''},{sets_min:5,sets_max:2},{reps_min:10,reps_max:6},{percent_min:'70',percent_max:'50'}])assert.throws(()=>D.addCustomPlanItem(s,p.id,ownValues('friel-ex-1',bad)));
  assert.equal(p.items.length,0);D.addCustomPlanItem(s,p.id,ownValues('friel-ex-1',{rest_seconds:0,basis:'none'}));assert.equal(p.items[0].prescription.rest_seconds,0);D.validateState(s);
});
test('own plan calculates RM and body weight separately and supports time exercises',()=>{
  const s=demo(),p=D.createCustomPlan(s,s.activeProfileId,{name:'Własny'});
  D.addCustomPlanItem(s,p.id,ownValues('demo-ex-1'));
  D.addCustomPlanItem(s,p.id,ownValues('demo-ex-2',{basis:'body',percent_min:'25'}));
  D.addCustomPlanItem(s,p.id,ownValues('demo-ex-3',{basis:'none',seconds:45}));
  const w=D.startWorkout(s,p.id);assert.equal(w.phase_name,'Plan własny');assert.equal(w.exercises[0].snapshot.load.min,'60');assert.equal(w.exercises[1].snapshot.load.min,'20');assert.equal(w.exercises[2].snapshot.seconds,45);assert.equal(w.exercises[2].snapshot.reps_min,null);assert.equal(w.exercises[2].snapshot.parameter_code,'');
  D.saveSet(s,w.id,w.exercises[2].id,{weight:'0',seconds:47});assert.equal(w.exercises[2].sets[0].seconds,47);D.validateState(s);
});
test('editing, reordering and removing own items preserves session snapshots',()=>{
  const s=demo(),p=D.createCustomPlan(s,s.activeProfileId,{name:'Własny'});
  const a=D.addCustomPlanItem(s,p.id,ownValues('demo-ex-1')),b=D.addCustomPlanItem(s,p.id,ownValues('demo-ex-2',{basis:'body',percent_min:'25'}));
  D.moveItem(s,p.id,b.id,-1);assert.equal(p.items[0].id,b.id);
  const w=D.startWorkout(s,p.id),snapshot=D.clone(w);
  D.updateItem(s,p.id,a.id,ownValues('friel-ex-1',{sets_min:4,reps_min:6,basis:'fixed',fixed_weight:'45',notes:'Własna zmiana'}));p.items=p.items.filter(i=>i.id!==b.id);
  assert.deepEqual(w,snapshot);assert.equal(p.items[0].prescription.fixed_weight,'45');D.validateState(s);
});
test('native backup keeps own plans/exercises, parameters and workout results',async()=>{
  const s=demo(),old=D.clone(s.plans[0]),ex=D.addExercise(s,{name:'Moje ćwiczenie',mode:'reps',load_notation:'kg',description:'Mój opis'}),p=D.createCustomPlan(s,s.activeProfileId,{name:'Mój własny'});
  D.addCustomPlanItem(s,p.id,ownValues(ex.id,{basis:'body',percent_min:'25'}));const w=D.startWorkout(s,p.id);D.saveSet(s,w.id,w.exercises[0].id,{weight:'20',reps:10});D.finish(s,w.id);
  const target=demo();B.importBackup(target,await B.parseBackup(JSON.stringify(B.makeBackup(s,s.activeProfileId))));
  const restored=target.plans.find(D.isCustomPlan);assert(restored);assert.equal(restored.phase_id,null);assert.equal(restored.items[0].prescription.notes,'Kontroluj ruch');assert(target.exercises.find(e=>e.id===restored.items[0].exercise_id).is_custom);assert.equal(target.workouts[0].exercises[0].snapshot.load.min,'20');D.validateState(target);assert.deepEqual(s.plans[0],old);
});
test('deleting a plan preserves completed and active sessions, snapshots and other plans',async()=>{
  const {s,w,ex}=session();save(s,w,ex);D.finish(s,w.id);const active=D.startWorkout(s,s.plans[0].id),old=D.clone(s.workouts);
  const other=D.createCustomPlan(s,s.activeProfileId,{name:'Nie usuwaj'}),remaining=D.clone(other),removed=s.plans[0].id;
  D.deletePlan(s,removed);assert.equal(s.plans.length,1);assert.deepEqual(s.plans[0],remaining);
  for(const [i,row] of s.workouts.entries()){assert.equal(row.plan_id,null);assert.deepEqual({...row,plan_id:old[i].plan_id},old[i]);}
  assert.equal(s.workouts.find(x=>x.id===active.id).status,'active');assert.equal(D.exerciseProgress(s,w.profile_id,ex.snapshot.exercise_id).length,1);D.validateState(s);
  const target=demo();B.importBackup(target,await B.parseBackup(JSON.stringify(B.makeBackup(s))));assert(target.workouts.every(x=>x.plan_id===null));D.validateState(target);
});
test('own-plan backup rejects forged phase links and missing custom parameters',async()=>{
  const s=demo(),p=D.createCustomPlan(s,s.activeProfileId,{name:'Mój'});D.addCustomPlanItem(s,p.id,ownValues('demo-ex-1'));
  for(const corrupt of [x=>x.plans.at(-1).phase_id='AA',x=>x.plans.at(-1).items[0].slot_id='AA-1',x=>x.plans.at(-1).items[0].prescription.rest_seconds=null,x=>x.plans.at(-1).items[0].prescription.percent_min=null]) {
    const bad=D.clone(s);corrupt(bad);await assert.rejects(()=>B.parseBackup(JSON.stringify({format:'sila-na-trase-local',version:1,data:bad})));
  }
});
