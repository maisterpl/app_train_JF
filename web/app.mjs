import * as D from './domain.mjs';
import {initialize,mutate,readState,changes} from './storage.mjs';
import {makeBackup,parseBackup,importBackup,resultsCSV,MAX_BACKUP_BYTES} from './backup.mjs';

const $=selector=>document.querySelector(selector),app=$('#app');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=D.formatNumber;
const link=(path,label,classes='button secondary')=>`<a class="${classes}" href="#/${esc(path)}">${esc(label)}</a>`;
const button=(action,label,attrs='',classes='secondary')=>`<button type="button" class="${classes}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
const field=(name,label,value='',attrs='',type='text')=>`<div class="field"><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
const select=(name,label,options,value)=>`<div class="field"><label for="${name}">${esc(label)}</label><select id="${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
const textarea=(name,label,value='',max=10000)=>`<div class="field"><label for="${name}">${esc(label)}</label><textarea id="${name}" name="${name}" maxlength="${max}">${esc(value)}</textarea></div>`;
const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
const range=(low,high)=>low==null?'Brak danych':`${n(low)}${high!=null&&String(high)!==String(low)?'–'+n(high):''}`;
const profile=()=>D.activeProfile(state);
const owns=row=>{if(row.profile_id!==profile()?.id) throw Error('Zmień aktywny profil, aby otworzyć te dane.');return row;};
const phaseFor=plan=>D.byId(state.phases,plan.phase_id);
const exName=id=>D.byId(state.exercises,id).name;
const head=(title,subtitle='',back='')=>`${back?link(back,'← Wróć','back'):''}<div class="heading"><div><span class="eyebrow">Twój trening, krok po kroku</span><h1>${esc(title)}</h1>${subtitle?`<p class="muted">${esc(subtitle)}</p>`:''}</div></div>`;
let state,preparedImport=null,routeToken=0,editingSet=null,saving=false,lastSetAt=0,formSetId=D.uid(),registration=null;
const drafts=new Map();
function notice(message,error=false) {const el=$('#notice');el.textContent=message;el.dataset.error=String(error);el.hidden=false;if(error)el.scrollIntoView({block:'nearest'});}
function clearNotice() {$('#notice').hidden=true;}
async function commit(command) {const result=await mutate(command);state=result.state;return result.result;}
const route=()=>location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
function go(path) { if(location.hash===`#/${path}`)render();else location.hash=`/${path}`; }
function profileBar() {
  $('#active-profile').innerHTML=state.profiles.length?state.profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===state.activeProfileId?'selected':''}>${esc(p.name)}</option>`).join(''):'<option value="">Dodaj pierwszy profil</option>';
  const first=route()[0]||'start';
  for(const a of document.querySelectorAll('nav a')) {const matches=a.hash===`#/${first}`||(first==='workout'&&a.hash==='#/history')||(first==='plan'&&a.hash==='#/plans')||(first==='exercise'&&a.hash==='#/exercises')||(first==='profiles'&&a.hash==='#/profile');if(matches)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
}
function emptyProfile() {return head('Zacznij od swojego profilu')+`<section class="card empty"><h2>Witaj na trasie po siłę</h2><p>Dodaj profil, wybierz fazę i przygotuj plan. Wszystkie dane zapiszą się na tym urządzeniu, także podczas treningu offline.</p><div class="actions">${link('profile/new','Dodaj profil','button')}${button('demo','Wypróbuj dane DEMO')}${link('settings','Importuj kopię')}</div></section>`;}
function startView() {
  const p=profile(),ws=state.workouts.filter(w=>w.profile_id===p.id).sort((a,b)=>b.started_at.localeCompare(a.started_at)),active=ws.filter(w=>w.status==='active'),plans=state.plans.filter(x=>x.profile_id===p.id),body=D.latest(state.weights,p.id,D.today());
  const last=ws.find(w=>w.status==='completed');
  return head(`Cześć, ${p.name}`, 'Zbuduj siłę, która zostanie z Tobą na trasie.')+`<section class="card hero"><span class="badge">${active.length?'Trening w toku':'Gotowy na kolejną sesję?'}</span><h2>${esc(active[0]?.plan_name||'Twój plan. Twoje tempo.')}</h2><p>${active.length?'Wróć dokładnie tam, gdzie skończyłeś. Zapisane serie czekają na urządzeniu.':'Wybierz fazę, dopasuj ćwiczenia i rozpocznij trening.'}</p><div class="actions">${active.length?link(`workout/${active[0].id}`,'Wznów trening','button'):link('plans',plans.length?'Wybierz plan':'Utwórz pierwszy plan','button')}</div></section><div class="grid three"><section class="card"><span class="eyebrow">Treningi ukończone</span><p class="stat">${ws.filter(w=>w.status==='completed').length}</p><small>Tylko wyniki tego profilu</small></section><section class="card"><span class="eyebrow">Ostatnia masa ciała</span><p class="stat">${body?n(body.value)+' kg':'Brak pomiaru'}</p>${link('profile',body?body.date:'Dodaj pomiar','')}</section><section class="card"><span class="eyebrow">Ostatni trening</span><p>${last?esc(last.plan_name):'Jeszcze przed Tobą'}</p>${last?link(`workout/${last.id}`,last.training_date,''):link('plans','Zobacz plany','')}</section></div>${active.length>1?`<h2>Pozostałe sesje w toku</h2>${active.slice(1).map(w=>`<p>${link(`workout/${w.id}`,w.plan_name)}</p>`).join('')}`:''}`;
}
function profilesView() {
  return head('Profile','Oddzielne osoby i wyniki na tym urządzeniu.')+`<section class="card"><ul class="list">${state.profiles.map(p=>`<li class="row"><div><strong>${esc(p.name)}</strong><br><small>${p.id===state.activeProfileId?'Aktywny profil':'Profil lokalny'}</small></div>${button('switch-profile','Wybierz',`data-id="${esc(p.id)}"`)}</li>`).join('')}</ul><div class="actions">${link('profile/new','Dodaj profil','button')}${link('settings','Importuj dane')}</div></section>`;
}
function profileForm(edit=false) {
  const p=edit?profile():{};
  return head(edit?'Edytuj profil':'Nowy profil','','profiles')+`<form class="card" data-form="profile">${hidden('id',p.id||'')}${field('name','Imię / nazwa',p.name||'','required maxlength="100" autocomplete="given-name"')}${textarea('notes','Uwagi',p.notes||'')}${select('rounding_step','Krok zaokrąglania obciążenia (kg)',[['0.5','0,5'],['1','1'],['2.5','2,5'],['5','5'],...(!['0.5','1','2.5','5',undefined].includes(p.rounding_step)?[[p.rounding_step,n(p.rounding_step)]]:[])],p.rounding_step||'2.5')}<div class="actions"><button type="submit">Zapisz profil</button>${link('profiles','Anuluj')}</div></form>`;
}
function profileView() {
  const p=profile(),weights=state.weights.filter(r=>r.profile_id===p.id).sort((a,b)=>b.date.localeCompare(a.date));
  return head(p.name,p.notes)+`<div class="actions">${link('profile/edit','Edytuj profil')}${link('profiles','Wszystkie profile')}</div><div class="grid"><form class="card" data-form="weight"><h2>Masa ciała</h2><p class="muted">Do obliczeń używany jest najnowszy pomiar dostępny na dzień treningu.</p>${field('date','Data',D.today(),'required','date')}${field('value','Masa ciała (kg)','','required inputmode="decimal" placeholder="np. 78,5"')}<small>Ponowny zapis tej samej daty aktualizuje pomiar.</small><div class="actions"><button type="submit">Zapisz pomiar</button></div></form><section class="card"><h2>Historia masy ciała</h2>${weights.length?`<ul class="list">${weights.map(r=>`<li class="row"><span>${esc(r.date)}</span><strong>${n(r.value)} kg</strong></li>`).join('')}</ul>`:'<p>Brak zapisanych pomiarów.</p>'}<p>Zaokrąglanie obciążeń: <strong>${n(p.rounding_step)} kg</strong></p></section></div>`;
}
function phaseSummary(phase) {
  return `<p>${esc(phase.description||'Brak danych')}</p><p><strong>Sesje:</strong> ${phase.sessions_unlimited?'bez określonego limitu':range(phase.sessions_min,phase.sessions_max)} · <strong>W tygodniu:</strong> ${range(phase.weekly_min,phase.weekly_max)}</p><details><summary>Źródło danych</summary><p>${esc(phase.source||'Brak danych')}</p></details>`;
}
function plansView() {
  const plans=state.plans.filter(p=>p.profile_id===profile().id);
  const phases=state.phases;
  return head('Plany','Wybierz zapisany plan lub skorzystaj z gotowego zestawu fazy.')+`<section class="card"><div class="row"><h2>Twoje plany</h2>${link('plan/new','Nowy plan','button')}</div>${plans.length?`<ul class="list">${plans.map(p=>`<li class="row"><div><strong>${esc(p.name)}</strong><br><small>${esc(phaseFor(p).name)} · ${p.items.length} ćwiczeń</small></div>${link(`plan/${p.id}`,'Otwórz')}</li>`).join('')}</ul>`:'<p>Nie masz jeszcze planu. Wybierz jedną z faz poniżej.</p>'}</section><h2>Gotowe zestawy faz</h2><div class="grid">${phases.map(p=>`<section class="card"><span class="badge ${p.is_demo?'demo':''}">${esc(p.code)}</span><h3>${esc(p.name)}</h3>${phaseSummary(p)}<p>${state.slots.filter(r=>r.phase_id===p.id).length} pozycji do wyboru</p>${link(`plan/new/${p.id}`,'Utwórz plan tej fazy')}</section>`).join('')}</div>`;
}
function planNewView(phaseId) {
  const phases=state.phases;
  const selected=phaseId?D.byId(state.phases,phaseId):phases[0];
  return head('Nowy plan','Najpierw nazwa i faza, potem wybór ćwiczeń.','plans')+`<form class="card" data-form="plan-create">${field('name','Nazwa planu',`${selected.code} — mój trening`,'required maxlength="160"')}${select('phase_id','Faza',phases.map(p=>[p.id,p.name]),selected.id)}<button type="submit">Dalej — wybierz ćwiczenia</button></form>`;
}
function prescriptionSummary(p) {
  return `<div class="prescription"><div><small>Serie</small><strong>${p.series_load_mode==='endpoints'?p.chosen_sets||'2 lub 3':range(p.sets_min,p.sets_max)}</strong></div><div><small>${p.seconds!=null?'Czas':'Powtórzenia'}</small><strong>${p.seconds!=null?n(p.seconds)+' s':esc(p.reps_original||range(p.reps_min,p.reps_max))}</strong></div><div><small>Odpoczynek</small><strong>${range(p.rest_seconds,p.rest_seconds_max)} s</strong></div></div><p><strong>Tempo:</strong> ${esc(p.tempo||'Brak danych')}</p>`;
}
function planView(id) {
  const p=owns(D.byId(state.plans,id)),phase=phaseFor(p),body=D.latest(state.weights,profile().id,D.today());
  return head(p.name,phase.name,'plans')+`<section class="card"><form data-form="plan-rename">${hidden('plan_id',p.id)}${field('name','Nazwa planu',p.name,'required maxlength="160"')}<button class="secondary small" type="submit">Zmień nazwę</button></form><details><summary>Parametry i źródło fazy</summary>${phaseSummary(phase)}</details></section>${!body?`<p class="warning">Brak pomiaru masy ciała. ${link('profile','Dodaj pomiar','')}.</p>`:''}<section class="card"><h2>Wybrane ćwiczenia · ${p.items.length}</h2>${p.items.map((i,index)=>{
    const rm=D.latest(state.rms,profile().id,D.today(),i.exercise_id),load=D.calculateLoad(i.prescription,rm?.value,body?.value,profile().rounding_step);
    return `<div class="phase-option"><span class="badge">${i.overridden?'Zmiany własne w planie':'Zalecenia fazy '+(i.prescription.parameter_code||phase.code||'')}</span><h3>${index+1}. ${esc(exName(i.exercise_id))}</h3>${prescriptionSummary(i.prescription)}<p>${esc(load.explanation)}</p>${load.series_loads?load.series_loads.map(r=>`<p>Seria ${r.number}: ${esc(r.explanation)}</p>`).join(''):''}${i.prescription.parameter_code==='SM'?`<details><summary>Oddzielny cel końcowy SM</summary><p>${esc(D.calculateGoal(state.goals.find(g=>g.phase_id===p.phase_id&&g.exercise_id===i.exercise_id),body?.value))}</p></details>`:''}<div class="actions">${button('move','↑',`data-plan="${p.id}" data-id="${i.id}" data-delta="-1" aria-label="Przesuń w górę" ${index===0?'disabled':''}`)}${button('move','↓',`data-plan="${p.id}" data-id="${i.id}" data-delta="1" aria-label="Przesuń w dół" ${index===p.items.length-1?'disabled':''}`)}${link(`plan/${p.id}/item/${i.id}`,'Edytuj parametry')}${button('remove-item','Usuń',`data-plan="${p.id}" data-id="${i.id}"`,'danger small')}</div></div>`;
  }).join('')||'<p>Dodaj ćwiczenia do planu.</p>'}<div class="actions">${link(`plan/${p.id}/add`,'Dodaj ćwiczenie')}</div></section>${p.items.length?`<form class="card" data-form="start-workout">${hidden('plan_id',p.id)}<h2>Rozpocznij trening</h2><p>Plan jest już zapisany na urządzeniu i dostępny offline.</p>${field('date','Dzień treningu',D.today(),'required','date')}<button type="submit">Rozpocznij trening</button></form>`:''}`;
}
function planAddView(id) {
  const p=owns(D.byId(state.plans,id)),slots=state.slots.filter(r=>r.phase_id===p.phase_id&&!p.items.some(i=>i.slot_id===r.id)).sort((a,b)=>a.position-b.position);
  return head('Dodaj ćwiczenia',phaseFor(p).name,`plan/${p.id}`)+`<form class="card" data-form="plan-add">${hidden('plan_id',p.id)}<p>Zaznacz pozycje, które chcesz wykonywać. Kolejność zmienisz po zapisaniu.</p>${slots.map(slot=>`<section class="phase-option"><div class="check-row"><input type="checkbox" id="slot-${esc(slot.id)}" name="slot" value="${esc(slot.id)}" ${p.items.length?'':'checked'}><label for="slot-${esc(slot.id)}">${esc(slot.title)}</label></div>${select(`exercise-${slot.id}`,'Wariant ćwiczenia',slot.allowed_exercise_ids.map(e=>[e,exName(e)]),slot.default_exercise_id)}${prescriptionSummary(slot.prescription)}${slot.prescription.series_load_mode==='endpoints'?select(`sets-${slot.id}`,'Liczba serii US',[['','Wybierz'],['2','2 serie: 60% / 80%'],['3','3 serie: 60% / własny ciężar / 80%']],''):''}<details><summary>Uwagi</summary><p>${esc(slot.prescription.notes||'Brak danych')}</p></details></section>`).join('')||'<p>Wszystkie pozycje fazy są już w planie.</p>'}<div class="actions">${slots.length?'<button type="submit">Dodaj wybrane ćwiczenia</button>':''}${link(`plan/${p.id}`,'Wróć do planu')}</div></form>`;
}
function itemEditView(planId,itemId) {
  const plan=owns(D.byId(state.plans,planId)),item=D.byId(plan.items,itemId),p=item.prescription,slot=item.slot_id?D.byId(state.slots,item.slot_id):null;
  const nums=[['sets_min','Serie od'],['sets_max','Serie do'],['reps_min','Powtórzenia od'],['reps_max','Powtórzenia do'],['seconds','Czas ćwiczenia (s)'],['rest_seconds','Odpoczynek od (s)'],['rest_seconds_max','Odpoczynek do (s)']];
  return head('Parametry ćwiczenia',exName(item.exercise_id),`plan/${plan.id}`)+`<form class="card" data-form="item-edit">${hidden('plan_id',plan.id)}${hidden('item_id',item.id)}<p class="info">Zmieniasz parametry tego planu. Zalecenia źródłowe fazy i zapisane sesje zachowują swoje wartości.</p>${select('exercise_id','Ćwiczenie',(slot?.allowed_exercise_ids||[item.exercise_id]).map(id=>[id,exName(id)]),item.exercise_id)}<div class="form-grid">${nums.map(([k,l])=>field(k,l,p[k]??'','min="'+(k.startsWith('rest')?0:1)+'" step="1"','number')).join('')}${select('basis','Podstawa obliczeń',[['','Brak danych'],['rm','Procent 1RM'],['body','Procent masy ciała'],['fixed','Stały ciężar'],['none','Bez dodatkowego obciążenia']],p.basis)}${field('percent_min','Procent od',p.percent_min??'','inputmode="decimal"')}${field('percent_max','Procent do',p.percent_max??'','inputmode="decimal"')}${field('fixed_weight','Stały ciężar (kg)',p.fixed_weight??'','inputmode="decimal"')}${field('tempo','Tempo',p.tempo||'','maxlength="80"')}</div>${select('series_load_mode','Sposób obciążania serii',[['uniform','Wspólne zalecenie'],['endpoints','US: pierwsza 60%, ostatnia 80% 1RM']],p.series_load_mode||'uniform')}${select('chosen_sets','Liczba serii US',[['','Nie dotyczy / brak wyboru'],['2','2'],['3','3']],p.chosen_sets||'')}${field('middle_weight','US: własny ciężar środkowej serii (kg)',p.middle_weight??'','inputmode="decimal"')}${textarea('notes','Uwagi',p.notes||'')}<div class="actions"><button type="submit">Zapisz własne parametry</button>${button('reset-item','Przywróć zalecenia fazy',`data-plan="${plan.id}" data-id="${item.id}" ${slot?'':'disabled'}`)}</div></form>`;
}
function historyView() {
  const rows=state.workouts.filter(w=>w.profile_id===profile().id).sort((a,b)=>b.training_date.localeCompare(a.training_date)||b.started_at.localeCompare(a.started_at));
  return head('Treningi','Zapisane sesje i treningi w toku.')+`<section class="card">${rows.length?`<ul class="list">${rows.map(w=>`<li class="row"><div><span class="badge">${w.status==='active'?'W trakcie':'Zakończony'}</span><h3>${esc(w.plan_name)}</h3><small>${esc(w.training_date)} · ${esc(w.phase_name)} · ${w.exercises.reduce((n,e)=>n+e.sets.length,0)} serii</small></div>${link(`workout/${w.id}`,w.status==='active'?'Wznów':'Szczegóły')}</li>`).join('')}</ul>`:'<p>Nie masz jeszcze zapisanych treningów.</p>'}</section>`;
}
const setResult=(row,time)=>`${time?n(row.seconds)+' s':n(row.weight)+' kg × '+n(row.reps)}${row.note?' · '+esc(row.note):''}`;
function workoutView(id) {
  const w=owns(D.byId(state.workouts,id));
  if(w.status==='completed') {
    const minutes=Math.max(0,Math.round((Date.parse(w.finished_at)-Date.parse(w.started_at))/60000));
    return head('Trening zakończony',`${w.plan_name} · ${w.training_date} · ${minutes} min`,'history')+`<p class="info">Sesja zapisana na urządzeniu. Historyczne parametry i wyniki pozostają zachowane.</p>${w.exercises.map(e=>`<section class="card"><h2>${esc(e.snapshot.name)}</h2><small>${e.skipped?'Oznaczone jako pominięte':'Wykonane serie: '+e.sets.length}</small><ul class="set-list">${e.sets.map(r=>`<li>Seria ${r.number}: <strong>${setResult(r,e.snapshot.mode==='time')}</strong></li>`).join('')||'<li>Brak zapisanych serii.</li>'}</ul>${link(`exercise/${e.snapshot.exercise_id}`,'Historia i wykres','')}<details><summary>Parametry zapisane przy rozpoczęciu</summary>${prescriptionSummary(e.snapshot)}<p>${esc(e.snapshot.load.explanation)}</p><p>1RM: ${n(e.snapshot.rm)} kg · masa ciała: ${n(e.snapshot.body_weight)} kg</p></details></section>`).join('')}<div class="actions">${link('plans','Wybierz kolejny trening','button')}${link('settings','Eksportuj dane')}</div>`;
  }
  const e=w.exercises[w.current_position],p=e.snapshot,time=p.mode==='time',loadRow=p.load.series_loads?.[Math.min(e.sets.length,(p.load.series_loads?.length||1)-1)]||p.load;
  if(editingSet && !e.sets.some(r=>r.id===editingSet)) editingSet=null;
  const row=e.sets.find(r=>r.id===editingSet),draft=drafts.get(e.id);
  const values=row||draft||{weight:loadRow.min??(p.basis==='none'?'0':''),reps:p.reps_min??'',seconds:p.seconds??'',note:''};
  return head(p.name,`Ćwiczenie ${w.current_position+1} z ${w.exercises.length} · ${w.plan_name}`,'history')+`${w.body_weight==null?`<p class="warning">Brak masy ciała w kopii tej sesji. ${link('profile','Dodaj pomiar dla kolejnych sesji','')}.</p>`:''}<section class="card"><span class="badge">${p.overridden?'Własne parametry planu':'Zalecenia fazy '+(p.parameter_code||p.phase_code||'')}</span>${prescriptionSummary(p)}<p><strong>Zalecany ciężar</strong></p><p id="load-explanation">${esc(p.load.explanation)}</p>${p.load.series_loads?p.load.series_loads.map(r=>`<p>Seria ${r.number}: ${esc(r.explanation)}</p>`).join(''):''}${p.end_goal?`<details><summary>Cel końcowy SM</summary><p>${esc(typeof p.end_goal==='string'?p.end_goal:p.end_goal.explanation)}</p></details>`:''}<details><summary>Uwagi i zapis obciążenia</summary><p>${esc(p.notes||'Brak danych')}</p><p>${esc(p.description||'Brak danych')}</p><p>${esc(p.load_notation||'Brak danych')}</p><p>1RM w sesji: ${n(p.rm)} kg${p.rm_date?' ('+esc(p.rm_date)+')':''}. Masa ciała: ${n(p.body_weight)} kg.</p></details></section><div class="grid"><section class="card"><div class="rest"><span>Odpoczynek</span><output id="rest-timer" aria-live="off">0:00</output>${button('stop-timer','Zatrzymaj','','secondary small')}</div><form id="set-form" data-form="set-save">${hidden('workout_id',w.id)}${hidden('exercise_id',e.id)}${hidden('id',row?.id||formSetId)}<h2>${row?'Edytuj serię '+row.number:'Seria '+(e.sets.length+1)}</h2><div class="field"><label for="weight">Ciężar (kg)</label><div class="stepper"><input id="weight" name="weight" value="${esc(values.weight)}" required inputmode="decimal" autocomplete="off"></div><div class="step-buttons">${[-10,-5,-1,1,5,10].map(v=>button('adjust',`${v>0?'+':''}${v}`,`data-field="weight" data-delta="${v}" aria-label="Zmień ciężar o ${v} kg"`)).join('')}</div></div><div class="field"><label for="${time?'seconds':'reps'}">${time?'Czas (s)':'Powtórzenia'}</label><div class="stepper">${button('adjust','−',`data-field="${time?'seconds':'reps'}" data-delta="${time?-5:-1}" aria-label="Zmniejsz ${time?'czas':'powtórzenia'}"`)}<input id="${time?'seconds':'reps'}" name="${time?'seconds':'reps'}" type="number" min="0" step="1" value="${esc(time?values.seconds:values.reps)}" required inputmode="numeric">${button('adjust','+',`data-field="${time?'seconds':'reps'}" data-delta="${time?5:1}" aria-label="Zwiększ ${time?'czas':'powtórzenia'}"`)}</div></div>${textarea('note','Notatka (opcjonalnie)',values.note||'',500)}<div class="actions"><button type="submit">${row?'Zapisz poprawkę':'Zapisz serię'}</button>${row?button('cancel-edit','Anuluj edycję'):''}</div></form></section><section class="card"><h2>Bieżące serie</h2><ul class="set-list">${e.sets.map(r=>`<li><div><strong>${r.number}. ${setResult(r,time)}</strong></div><div class="actions">${button('edit-set','Edytuj',`data-id="${r.id}"`,'secondary small')}${button('delete-set','Usuń',`data-id="${r.id}"`,'danger small')}</div></li>`).join('')||'<li>Nie zapisano jeszcze serii.</li>'}</ul><h3>Ostatnie wyniki</h3>${p.previous_results?.length?`<ul class="list">${p.previous_results.map(r=>`<li><small>${esc(r.date)}</small><br>${setResult(r,time)}</li>`).join('')}</ul>`:'<p>To ćwiczenie nie ma jeszcze zapisanej historii.</p>'}</section></div><div class="card actions">${button('previous','← Poprzednie',w.current_position===0?'disabled':'')}${button('next','Następne →',w.current_position===w.exercises.length-1?'disabled':'')}${button('skip','Pomiń ćwiczenie')}${button('finish','Zakończ trening','','')}</div>`;
}
function exercisesView() {
  const list=[...state.exercises].sort((a,b)=>a.name.localeCompare(b.name,'pl'));
  return head('Ćwiczenia','Rekordy 1RM, historia i wykresy tego profilu.')+`<section class="card"><label for="exercise-search">Szukaj ćwiczenia</label><input id="exercise-search" type="search" placeholder="Nazwa lub kategoria" autocomplete="off"><ul class="list" id="exercise-list">${list.map(e=>{const rm=D.latest(state.rms,profile().id,D.today(),e.id);return `<li data-search="${esc((e.name+' '+e.category).toLocaleLowerCase('pl'))}"><div class="row"><div><strong>${esc(e.name)}</strong><br><small>${esc(e.category)} · ${e.mode==='time'?'Czas':'Powtórzenia'}${rm?' · 1RM '+n(rm.value)+' kg':''}</small></div>${link(`exercise/${e.id}`,'Historia i 1RM')}</div></li>`;}).join('')}</ul></section>`;
}
function progressChart(points,time) {
  if(!points.length) return '<p>To ćwiczenie nie ma jeszcze zapisanej historii.</p>';
  const minDate=Math.min(...points.map(p=>Date.parse(p.date))),maxDate=Math.max(...points.map(p=>Date.parse(p.date))),max=Math.max(1,...points.map(p=>p.value));
  const x=p=>maxDate===minDate?330:60+(Date.parse(p.date)-minDate)/(maxDate-minDate)*540,y=p=>205-p.value/max*165;
  return `<svg class="chart" viewBox="0 0 650 250" role="img" aria-label="${time?'Maksymalny czas':'Maksymalny ciężar'} w kolejnych sesjach"><title>Progres na podstawie ukończonych treningów</title>${Array.from({length:5},(_,i)=>{const yy=205-i*165/4;return `<line x1="60" y1="${yy}" x2="600" y2="${yy}"/><text x="50" y="${yy+4}" text-anchor="end">${n(max*i/4)}</text>`;}).join('')}<text x="60" y="22">${time?'s':'kg'}</text><polyline points="${points.map(p=>`${x(p)},${y(p)}`).join(' ')}"/>${points.map(p=>`<a href="#/workout/${esc(p.workout_id)}" aria-label="${esc(p.date)}: ${n(p.value)} ${time?'sekund':`kg, ${p.reps} powtórzeń`}"><circle cx="${x(p)}" cy="${y(p)}" r="6"><title>${esc(p.date)} · ${n(p.value)} ${time?'s':'kg × '+p.reps}</title></circle></a>`).join('')}<text x="60" y="237">${esc(points[0].date)}</text>${points.length>1?`<text x="600" y="237" text-anchor="end">${esc(points.at(-1).date)}</text>`:''}</svg><div class="table-wrap"><table><thead><tr><th>Data</th><th>${time?'Czas':'Maks. ciężar'}</th>${time?'':'<th>Powtórzenia</th>'}<th>Sesja</th></tr></thead><tbody>${points.map(p=>`<tr><td>${esc(p.date)}</td><td>${n(p.value)} ${time?'s':'kg'}</td>${time?'':`<td>${p.reps}</td>`}<td>${link(`workout/${p.workout_id}`,'Zobacz','')}</td></tr>`).join('')}</tbody></table></div>`;
}
function exerciseView(id) {
  const ex=D.byId(state.exercises,id),rms=state.rms.filter(r=>r.profile_id===profile().id&&r.exercise_id===id).sort((a,b)=>b.date.localeCompare(a.date)),points=D.exerciseProgress(state,profile().id,id),time=ex.mode==='time';
  const history=state.workouts.filter(w=>w.profile_id===profile().id && w.exercises.some(e=>e.snapshot.exercise_id===id&&e.sets.length)).sort((a,b)=>b.training_date.localeCompare(a.training_date)||b.started_at.localeCompare(a.started_at));
  return head(ex.name,ex.category,'exercises')+`<section class="card"><p>${esc(ex.description||'Brak danych')}</p><p><strong>Zapis obciążenia:</strong> ${esc(ex.load_notation||'Brak danych')}</p></section><section class="card" id="progress-chart"><h2>${time?'Progres czasu':'Progres maksymalnego ciężaru'}</h2><p class="muted">Jeden najlepszy wynik z każdej ukończonej sesji aktywnego profilu.${time?'':' Liczba powtórzeń daje kontekst obciążenia.'}</p>${progressChart(points,time)}</section>${!time?`<div class="grid"><form class="card" data-form="rm">${hidden('exercise_id',id)}<h2>Zapisz 1RM</h2><p>Serie treningowe nie zmieniają tej wartości automatycznie.</p>${field('date','Data',D.today(),'required','date')}${field('value','1RM (kg)','','required inputmode="decimal"')}<button type="submit">Zapisz ręczny 1RM</button></form><form class="card" data-form="estimate">${hidden('exercise_id',id)}<h2>Szacowanie 1RM · tabela 13.7</h2>${field('source_weight','Ciężar próby (kg)','','required inputmode="decimal"')}${select('source_reps','Powtórzenia próby',[4,5,6,7,8,9,10].map(v=>[v,v]),6)}${field('date','Data próby',D.today(),'required','date')}<button type="submit" class="secondary">Oblicz i sprawdź</button><div id="estimate-result"></div></form></div><section class="card"><h2>Historia 1RM</h2><ul class="list">${rms.map(r=>`<li>${esc(r.date)} · <strong>${n(r.value)} kg</strong> · ${r.is_estimated?'szacowany (próba '+n(r.source_weight)+' kg × '+r.source_reps+')':'wpis ręczny'}</li>`).join('')||'<li>Brak zapisanych wartości 1RM.</li>'}</ul></section>`:''}<section class="card"><h2>Historia ćwiczenia</h2>${history.length?history.map(w=>`<div class="phase-option"><h3>${esc(w.training_date)} · ${esc(w.plan_name)}</h3><small>${w.status==='active'?'W trakcie':'Zakończony'}</small><ul class="list">${w.exercises.filter(e=>e.snapshot.exercise_id===id).flatMap(e=>e.sets.map(r=>`<li>${r.number}. ${setResult(r,e.snapshot.mode==='time')}</li>`)).join('')}</ul>${link(`workout/${w.id}`,'Otwórz sesję','')}</div>`).join(''):'<p>To ćwiczenie nie ma jeszcze zapisanej historii.</p>'}</section>`;
}
function settingsView() {
  return head('Ustawienia','Kopie zapasowe i informacje o zapisie danych.')+`<section class="card"><h2>Twoje dane są na tym urządzeniu</h2><p>Aplikacja nie wysyła treningów na serwer. Profile są lokalne — telefon, komputer i różne przeglądarki mają oddzielne bazy. Nie ma kont ani podglądu danych innych osób przez administratora.</p><p class="warning">Wyczyszczenie danych witryny, tryb prywatny albo utrata urządzenia mogą usunąć historię. Regularnie pobieraj kopię JSON i przechowuj ją poza tą przeglądarką.</p><p>Ostatni pobrany eksport: <strong>${state.lastExportAt?esc(new Date(state.lastExportAt).toLocaleString('pl-PL')):'brak'}</strong>. Zapisz pobrany plik w bezpiecznym miejscu.</p><div class="actions">${button('export-all','Eksportuj wszystko · JSON','','')}${button('export-profile','Eksportuj aktywny profil',profile()?'':'disabled')}${button('export-csv','Wyniki profilu · CSV',profile()?'':'disabled')}</div></section><section class="card"><h2>Importuj kopię zapasową</h2><p>Obsługiwane: kopia JSON tej aplikacji oraz eksport JSON wersji Django (schema 2). CSV służy do analizy wyników, nie do odtwarzania danych.</p><p>Import dodaje nowe profile z dopiskiem „(import)”. Obecne dane pozostają zachowane. Ponowny import dokładnie tego samego pliku jest blokowany; import nie scala zmian między urządzeniami.</p><label for="import-file">Wybierz plik JSON (do 20 MB)</label><input id="import-file" type="file" accept="application/json,.json"><div id="import-preview"></div></section><section class="card"><h2>Praca offline i aktualizacje</h2><p id="storage-info">Sprawdzanie miejsca…</p><div class="actions">${button('persist','Poproś o trwałe przechowywanie')}${button('install','Zainstaluj aplikację','hidden')}${button('update','Sprawdź aktualizację')}${button('apply-update','Zastosuj nową wersję',registration?.waiting?'':'hidden')}</div><p>Najpierw otwórz aplikację online i zaczekaj na komunikat „Gotowa offline”. Potem wszystkie ekrany i zapis treningów działają bez sieci. Połączenie nie uruchamia synchronizacji danych.</p><p>Zmiana domeny lub przeglądarki wymaga eksportu i importu. Instalacja PWA również nie zastępuje kopii zapasowej.</p></section><section class="card"><h2>Dane DEMO</h2><p>Osobny profil z przykładowym planem, masą i 1RM. Liczby DEMO nie są zaleceniami Joe Friela.</p>${button('demo','Dodaj profil DEMO')}</section>`;
}
async function render() {
  if(!state) return;
  const token=++routeToken;profileBar();
  const r=route(),screen=r[0]||'start';
  try {
    if(!profile() && !['profiles','profile','settings'].includes(screen)) app.innerHTML=emptyProfile();
    else if(screen==='start') app.innerHTML=startView();
    else if(screen==='profiles') app.innerHTML=profilesView();
    else if(screen==='profile') app.innerHTML=r[1]==='new'?profileForm():r[1]==='edit'&&profile()?profileForm(true):profile()?profileView():emptyProfile();
    else if(screen==='plans') app.innerHTML=plansView();
    else if(screen==='plan') app.innerHTML=r[1]==='new'?planNewView(r[2]):r[2]==='add'?planAddView(r[1]):r[2]==='item'?itemEditView(r[1],r[3]):planView(r[1]);
    else if(screen==='history') app.innerHTML=historyView();
    else if(screen==='workout') app.innerHTML=workoutView(r[1]);
    else if(screen==='exercises') app.innerHTML=exercisesView();
    else if(screen==='exercise') app.innerHTML=exerciseView(r[1]);
    else if(screen==='settings') {app.innerHTML=settingsView();preparedImport=null;storageInfo(token);if(installPrompt)$('[data-action=install]').hidden=false;}
    else app.innerHTML=head('Nie znaleziono strony')+link('start','Wróć na start');
    document.title=(app.querySelector('h1')?.textContent||'Trening')+' · Siła na trasę';
    tick();
  } catch(error) {app.innerHTML=head('Nie można otworzyć widoku')+`<p class="warning">${esc(error.message)}</p>`+link('start','Wróć na start');}
}
function rememberDraft() {const form=$('#set-form');if(form&&!editingSet)drafts.set(form.elements.exercise_id.value,Object.fromEntries(new FormData(form)));}
function tick() {
  const timer=$('#rest-timer');if(!timer)return;
  const w=state.workouts.find(x=>x.id===route()[1]),seconds=Math.max(0,Math.ceil(((w?.rest_until||0)-Date.now())/1000));timer.value=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
async function storageInfo(token) {
  const estimate=await navigator.storage?.estimate?.(),persisted=await navigator.storage?.persisted?.();
  if(token!==routeToken || !$('#storage-info'))return;
  $('#storage-info').textContent=`${estimate?`Zajęte miejsce witryny: ${(estimate.usage/1024/1024).toFixed(1)} MB. `:''}Trwałe przechowywanie: ${persisted?'przyznane':'nieprzyznane / niedostępne'}. Decyzję podejmuje przeglądarka. Kopia JSON jest nadal potrzebna.`;
}
function download(body,type,name) {
  const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();if(saving)return;
  const values=Object.fromEntries(new FormData(form)),kind=form.dataset.form;
  if(kind==='set-save' && Date.now()-lastSetAt<500)return;
  saving=true;clearNotice();const submit=form.querySelector('button[type=submit]');if(submit)submit.disabled=true;
  try {
    if(kind==='profile') {await commit(s=>values.id?D.updateProfile(s,values.id,values):D.addProfile(s,values));go('profile');}
    else if(kind==='weight') {await commit(s=>D.measure(s,'weights',profile().id,values));render();notice('Pomiar zapisany na urządzeniu.');}
    else if(kind==='rm') {await commit(s=>D.measure(s,'rms',profile().id,values));render();notice('1RM zapisany. Poprzednie pomiary pozostają w historii.');}
    else if(kind==='estimate') {
      const rm=D.estimateRM(values.source_weight,values.source_reps);D.date(values.date);
      $('#estimate-result').innerHTML=`<p class="info">Szacowane 1RM: <strong>${n(rm)} kg</strong>. Wynik nie został jeszcze zapisany.</p>${button('save-estimate','Potwierdź zapis szacowanego 1RM','','')}`;
      $('#estimate-result').dataset.values=JSON.stringify({...values,value:rm,is_estimated:true});
    }
    else if(kind==='plan-create') {const p=await commit(s=>D.createPlan(s,profile().id,values));go(`plan/${p.id}/add`);}
    else if(kind==='plan-rename') {await commit(s=>D.byId(s.plans,values.plan_id).name=D.text(values.name,'Nazwa planu',160,true));render();notice('Nazwa zapisana.');}
    else if(kind==='plan-add') {
      const choices=new FormData(form).getAll('slot').map(id=>({slot_id:id,exercise_id:values[`exercise-${id}`],chosen_sets:values[`sets-${id}`]||undefined}));
      if(!choices.length)throw Error('Zaznacz co najmniej jedno ćwiczenie.');
      await commit(s=>D.addPlanItems(s,values.plan_id,choices));go(`plan/${values.plan_id}`);
    }
    else if(kind==='item-edit') {
      const old=D.byId(D.byId(state.plans,values.plan_id).items,values.item_id).prescription;
      await commit(s=>D.updateItem(s,values.plan_id,values.item_id,{...values,parameter_code:old.parameter_code,reps_original:old.reps_original,clear_original:String(values.reps_min)!==String(old.reps_min??'')||String(values.reps_max)!==String(old.reps_max??'')}));go(`plan/${values.plan_id}`);
    }
    else if(kind==='start-workout') {
      const plan=owns(D.byId(state.plans,values.plan_id)),active=state.workouts.find(w=>w.plan_id===plan.id && w.status==='active');
      if(active) {go(`workout/${active.id}`);notice('Ten plan ma rozpoczętą sesję — wznowiono ją. Zakończ ją przed rozpoczęciem kolejnej.');}
      else {const w=await commit(s=>D.startWorkout(s,values.plan_id,values.date));editingSet=null;formSetId=D.uid();go(`workout/${w.id}`);}
    }
    else if(kind==='set-save') {
      await commit(s=>D.saveSet(s,values.workout_id,values.exercise_id,values));lastSetAt=Date.now();drafts.delete(values.exercise_id);editingSet=null;formSetId=D.uid();render();notice('Seria zapisana na urządzeniu.');
    }
  } catch(error) {notice(error.message,true);}
  finally {saving=false;if(submit?.isConnected)submit.disabled=false;}
});
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el || el.disabled)return;const action=el.dataset.action;
  if(action==='adjust') {
    const input=$('#'+el.dataset.field),current=Number(input.value.replace(',','.'))||0;input.value=String(Math.max(0,Math.round((current+Number(el.dataset.delta))*100)/100));rememberDraft();return;
  }
  if(saving)return;saving=true;clearNotice();el.disabled=true;
  try {
    const r=route(),w=r[0]==='workout'?owns(D.byId(state.workouts,r[1])):null,e=w?.exercises[w.current_position];
    if(action==='demo') {await commit(s=>D.seedDemo(s));go('start');notice('Dodano osobny profil DEMO.');}
    else if(action==='switch-profile') {await commit(s=>{D.byId(s.profiles,el.dataset.id);s.activeProfileId=el.dataset.id;});editingSet=null;go('start');}
    else if(action==='move') {await commit(s=>D.moveItem(s,el.dataset.plan,el.dataset.id,Number(el.dataset.delta)));render();}
    else if(action==='remove-item') {if(confirm('Usunąć pozycję z planu? Zapisane sesje zachowają historię.')){await commit(s=>{const p=D.byId(s.plans,el.dataset.plan);p.items=p.items.filter(i=>i.id!==el.dataset.id);});render();}}
    else if(action==='reset-item') {await commit(s=>{const p=D.byId(s.plans,el.dataset.plan),i=D.byId(p.items,el.dataset.id);i.prescription=D.prescription(D.byId(s.slots,i.slot_id).prescription);i.overridden=false;D.checkPlan(s,p);});render();}
    else if(action==='save-estimate') {const values=JSON.parse($('#estimate-result').dataset.values);await commit(s=>D.measure(s,'rms',profile().id,values));render();notice('Szacowany 1RM zapisany po potwierdzeniu.');}
    else if(action==='edit-set') {rememberDraft();editingSet=el.dataset.id;render();$('#weight').focus();}
    else if(action==='cancel-edit') {editingSet=null;render();}
    else if(action==='delete-set') {if(confirm('Usunąć tę serię?')){await commit(s=>D.removeSet(s,w.id,e.id,el.dataset.id));editingSet=null;render();}}
    else if(['previous','next','skip'].includes(action)) {
      rememberDraft();await commit(s=>action==='skip'?D.skip(s,w.id,e.id):D.navigate(s,w.id,w.current_position+(action==='next'?1:-1)));editingSet=null;formSetId=D.uid();render();
    }
    else if(action==='stop-timer') {await commit(s=>D.byId(s.workouts,w.id).rest_until=null);tick();}
    else if(action==='finish') {if(confirm('Zakończyć trening? Sprawdź, czy wszystkie serie zostały zapisane. Zakończonej sesji nie można edytować.')){await commit(s=>D.finish(s,w.id));editingSet=null;render();}}
    else if(action.startsWith('export-')) {
      if(!state.profiles.length)throw Error('Dodaj profil przed eksportem.');
      state=await readState();const fileDate=D.today();
      if(action==='export-csv')download(resultsCSV(state,profile().id),'text/csv;charset=utf-8',`wyniki-${fileDate}.csv`);
      else {download(JSON.stringify(makeBackup(state,action==='export-profile'?profile().id:null),null,2),'application/json',`sila-na-trase-${fileDate}.json`);await commit(s=>s.lastExportAt=new Date().toISOString());render();notice('Uruchomiono pobieranie kopii. Sprawdź, czy plik został zapisany.');}
    }
    else if(action==='import-confirm') {if(!preparedImport)throw Error('Najpierw wybierz plik.');const count=await commit(s=>importBackup(s,preparedImport));preparedImport=null;go('profiles');notice(`Import zakończony. Dodane profile: ${count}. Obecne dane zachowano.`);}
    else if(action==='persist') {const granted=await navigator.storage?.persist?.();notice(granted?'Przeglądarka przyznała trwałe przechowywanie. Nadal twórz kopie JSON.':'Przeglądarka nie przyznała trwałego przechowywania. Twórz kopie JSON.');await storageInfo(routeToken);}
    else if(action==='install') {if(installPrompt){await installPrompt.prompt();installPrompt=null;el.hidden=true;}}
    else if(action==='update') {if(!registration)throw Error('Service worker wymaga HTTPS lub localhost.');await registration.update();notice(registration.waiting?'Nowa wersja czeka. Możesz ją zastosować.':'Sprawdzono aktualizacje.');render();}
    else if(action==='apply-update') {rememberDraft();if($('#set-form'))throw Error('Zapisz serię i przejdź do Ustawień przed aktualizacją.');registration?.waiting?.postMessage('activate');}
  } catch(error){notice(error.message,true);}
  finally{saving=false;if(el.isConnected)el.disabled=false;}
});
document.addEventListener('input',event=>{
  if(event.target.closest('#set-form'))rememberDraft();
  if(event.target.id==='exercise-search') {const q=event.target.value.toLocaleLowerCase('pl');for(const li of document.querySelectorAll('#exercise-list>li'))li.hidden=!li.dataset.search.includes(q);}
});
document.addEventListener('change',async event=>{
  try {
    if(event.target.id==='active-profile' && event.target.value) {rememberDraft();await commit(s=>{D.byId(s.profiles,event.target.value);s.activeProfileId=event.target.value;});editingSet=null;go('start');}
    if(event.target.id==='import-file') {
      preparedImport=null;$('#import-preview').textContent='Sprawdzanie kopii…';const file=event.target.files[0];if(!file){$('#import-preview').textContent='';return;}
      if(file.size>MAX_BACKUP_BYTES)throw Error('Plik jest za duży (maks. 20 MB).');
      preparedImport=await parseBackup(await file.text());
      if(state.imported?.includes(preparedImport.fingerprint))throw Error('Ten plik został już zaimportowany.');
      const d=preparedImport.data;
      $('#import-preview').innerHTML=`<div class="info"><h3>Podgląd kopii ${preparedImport.legacy?'Django':''}</h3><p>Profile: ${d.profiles.map(p=>esc(p.name)).join(', ')}.</p><p>Plany: ${d.plans.length} · Treningi: ${d.workouts.length} · Serie: ${d.workouts.reduce((n,w)=>n+w.exercises.reduce((m,e)=>m+e.sets.length,0),0)}.</p><p>Obecne dane pozostaną zachowane. Powstaną nowe profile.</p>${button('import-confirm','Importuj jako nowe profile','','')}</div>`;
    }
  } catch(error){preparedImport=null;if($('#import-preview'))$('#import-preview').textContent='Import nie został wykonany.';notice(error.message,true);}
});
window.addEventListener('hashchange',()=>{clearNotice();editingSet=null;formSetId=D.uid();render();app.focus({preventScroll:true});window.scrollTo(0,0);});
changes.addEventListener('change',async()=>{
  try {const newer=await readState();if(newer.revision===state.revision)return;state=newer;rememberDraft();render();notice('Dane zostały odświeżone po zapisie w drugiej karcie.');}catch(error){notice(error.message,true);}
});
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;if($('[data-action=install]'))$('[data-action=install]').hidden=false;});
const connection=()=>$('#connection-status').textContent=`${navigator.onLine?'Online':'Offline'} · dane na urządzeniu`;
window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
setInterval(tick,1000);
async function setupWorker() {
  const status=$('#offline-status');
  if(!('serviceWorker' in navigator)||!isSecureContext){status.textContent='Offline wymaga HTTPS / localhost';return;}
  try {
    let controlled=Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controlled)location.reload();else {controlled=true;status.textContent='Gotowa offline';}});
    registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});
    const ready=()=>{status.textContent='Gotowa offline';if(registration.waiting){status.textContent='Nowa wersja czeka w Ustawieniach';if($('[data-action=apply-update]'))$('[data-action=apply-update]').hidden=false;}};
    navigator.serviceWorker.ready.then(ready);
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker.addEventListener('statechange',()=>{if(worker.state==='installed')ready();if(worker.state==='redundant')status.textContent='Błąd przygotowania offline — otwórz ponownie online';});});
    if(registration.active)ready();
  } catch {status.textContent='Nie udało się przygotować offline';}
}
try {
  const response=await fetch('./catalog.json');if(!response.ok)throw Error('Nie można wczytać katalogu ćwiczeń.');
  state=await initialize(await response.json());await render();setupWorker();
} catch(error) {
  app.innerHTML=`<section class="card"><h1>Nie można otworzyć aplikacji</h1><p>${esc(error.message)}</p><p>Włącz zapis danych witryn i otwórz aplikację przez HTTPS lub localhost. Pierwsze uruchomienie wymaga połączenia. Nie czyść danych przeglądarki, jeśli masz w niej niezapisany eksport treningów.</p><button type="button" data-action="reload">Spróbuj ponownie</button></section>`;
  $('[data-action=reload]')?.addEventListener('click',()=>location.reload());
}
