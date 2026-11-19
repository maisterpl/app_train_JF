// Intervals.icu REST API: https://intervals.icu/api/v1/docs
export const API='https://intervals.icu/api/v1';
export function summary(w) {
  if(w.status!=='completed')throw Error('Najpierw zakończ trening.');
  const seconds=Math.max(0,Math.round((Date.parse(w.finished_at)-Date.parse(w.started_at))/1000));
  return [`${w.plan_name} · ${w.training_date}`,`Czas treningu: ${Math.floor(seconds/60)} min ${seconds%60} s`,...w.exercises.flatMap(e=>['',e.snapshot.name+(e.skipped?' (pominięte)':''),...e.sets.map(r=>`${r.number}. ${r.weight} kg × ${e.snapshot.mode==='time'?`${r.seconds} s`:`${r.reps} powt.`}${r.note?' · '+r.note:''}`),...(!e.sets.length?['Brak zapisanych serii.']:[])])].join('\n');
}
export function payload(w,mode) {
  const description=summary(w),date=new Date(w.started_at),time=[date.getHours(),date.getMinutes(),date.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
  const common={name:w.plan_name,description,start_date_local:`${w.training_date}T${time}`,external_id:`sila-na-trase-${w.id}`};
  if(mode==='note')return {...common,category:'NOTE',uid:`sila-${w.id}`};
  if(mode!=='new')throw Error('Wybierz sposób eksportu.');
  const duration=Math.max(1,Math.round((Date.parse(w.finished_at)-date.getTime())/1000));
  return {...common,type:'WeightTraining',moving_time:duration,elapsed_time:duration};
}
export function client(key,fetcher=fetch) {
  if(typeof key!=='string'||!key.trim())throw Error('Połącz konto w Ustawieniach.');
  const authorization='Basic '+btoa('API_KEY:'+key.trim());
  return async (path,method='GET',body)=>{
    let response;
    try{response=await fetcher(API+path,{method,headers:{Authorization:authorization,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000)});}
    catch{throw Error(method==='GET'?'Nie udało się połączyć z Intervals.icu. Sprawdź internet.':'Nie otrzymano potwierdzenia wysyłki. Sprawdź Intervals.icu przed ponowną próbą; wpis mógł zostać zapisany.');}
    if(!response.ok)throw Error(response.status===401?'Nieprawidłowy klucz API. Połącz konto ponownie.':response.status===403?'Intervals.icu odmówiło dostępu. Sprawdź uprawnienia konta.':response.status===429?'Limit zapytań Intervals.icu. Spróbuj później.':`Intervals.icu: błąd ${response.status}. Sprawdź wynik na koncie przed ponowieniem wysyłki.`);
    if(response.status===204)return null;
    try{return await response.json();}catch{throw Error('Brak czytelnego potwierdzenia z Intervals.icu. Sprawdź konto przed ponowieniem.');}
  };
}
export async function activities(api,w) {
  const rows=await api(`/athlete/0/activities?oldest=${w.training_date}&newest=${w.training_date}`);
  if(!Array.isArray(rows))throw Error('Niepoprawna lista aktywności.');
  return rows.filter(r=>r.id&&r.start_date_local);
}
// Reconcile by stable markers before each write, including after a lost response.
export async function send(api,w,mode,activityId) {
  const marker=`[Siła na trasę: ${w.id}]`;
  if(mode==='existing') {
    if(!activityId)throw Error('Wybierz istniejącą aktywność.');
    const list=await activities(api,w);
    if(!list.some(r=>r.id===activityId))throw Error('Wybrana aktywność nie jest dostępna w dniu treningu.');
    const path=`/activity/${encodeURIComponent(activityId)}/messages`,messages=await api(path+'?limit=100');
    if(!Array.isArray(messages))throw Error('Nie udało się sprawdzić istniejących komentarzy.');
    if(messages.some(m=>m.content?.includes(marker)))return {id:activityId,reused:true};
    if(messages.length>=100)throw Error('Aktywność ma zbyt wiele komentarzy, aby bezpiecznie wykluczyć duplikat. Sprawdź ją w Intervals.icu.');
    await api(path,'POST',{content:summary(w)+'\n\n'+marker});return {id:activityId};
  }
  const data=payload(w,mode);
  if(mode==='note') {
    const path='/athlete/0/events',list=await api(`${path}?oldest=${w.training_date}&newest=${w.training_date}`);
    if(!Array.isArray(list))throw Error('Nie udało się sprawdzić notatek.');
    const prior=list.find(r=>r.uid===data.uid||r.external_id===data.external_id);
    if(prior)return {id:prior.id,reused:true};
    const result=await api(path,'POST',data);if(result?.id==null)throw Error('Brak identyfikatora zapisanego wpisu. Sprawdź konto przed ponowieniem.');return {id:result.id};
  }
  const list=await activities(api,w),prior=list.find(r=>r.external_id===data.external_id);
  if(prior)return {id:prior.id,reused:true};
  const result=await api('/athlete/0/activities/manual','POST',data);if(result?.id==null)throw Error('Brak identyfikatora zapisanego wpisu. Sprawdź konto przed ponowieniem.');return {id:result.id};
}
