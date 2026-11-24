import {addCustomPlanItem, addExercise, createCustomPlan, integer, text} from './domain.mjs';

export const MAX_PHASE_SIZE=1024*1024;

export function trainingPrompt(goal,basis) {
  return `Ułóż po polsku fazę treningu siłowego do aplikacji „Siła na trasę”.
Cel i warunki: ${text(goal,'Cel treningu',2000,true)}
Podstawa programu: ${text(basis,'Podstawa programu',2000,true)}

Przygotuj gotowe sesje na całą fazę. Gdy parametry różnią się między tygodniami, rozpisz osobne wersje sesji. Nie przypisuj własnych propozycji autorom wskazanych materiałów. Uwzględnij podany sprzęt i poziom.
Zwróć plik trening-ai.json do pobrania. Jeśli nie możesz dołączyć pliku, zwróć sam JSON w jednym bloku kodu. Użyj dokładnie tej struktury, podmieniając wartości przykładowe:
{"format":"sila-na-trase-ai-v1","name":"Faza siły","weeks":4,"sessions":[{"name":"Trening A","week_from":1,"week_to":4,"exercises":[{"name":"Pompki","mode":"reps","sets":3,"reps":8,"rest_seconds":90,"basis":"none","notes":"Opcjonalna wskazówka"}]}]}

Podaj od 1 do 52 tygodni, maksymalnie 100 sesji i do 30 ćwiczeń na sesję. Nazwa fazy i sesji: maks. 60 znaków każda. Zakres tygodni sesji musi mieścić się w fazie. Jeśli są różne treningi w tygodniu, podaj każdy osobno i nadaj mu nazwę zgodną z kolejnością (np. Trening A, Trening B).
Każde ćwiczenie podaje name, mode, sets, rest_seconds i basis. Dla mode "reps" podaj reps (opcjonalnie reps_max), dla "time" podaj seconds. basis: "none" (bez dodatkowego ciężaru), "fixed" z fixed_weight w kg, "rm" lub "body" z percent (opcjonalnie percent_max). Przy braku danych o 1RM nie wymyślaj rekordu ani stałego ciężaru. Podaj liczby bez jednostek. Opcjonalnie podaj tempo, notes (maks. 1000 znaków) oraz load_notation (np. "Ciężar jednego hantla w kg").`;
}

export function parseTrainingPhase(input) {
  if(input.length>MAX_PHASE_SIZE)throw Error('Plik treningu AI może mieć maksymalnie 1 MB.');
  const source=input.trim(), start=source.indexOf('{'), end=source.lastIndexOf('}');
  if(!source)throw Error('Wybierz plik lub wklej odpowiedź z ChatGPT.');
  const blocks=Array.from(source.matchAll(/```(?:json)?[ \t]*\r?\n([^]*?)```/gi), match=>match[1].trim());
  const candidates=[source,...blocks];
  if(start>=0&&end>start)candidates.push(source.slice(start,end+1));
  let parsed=false;
  for(const candidate of candidates) {
    let phase;
    try {phase=JSON.parse(candidate);} catch {continue;}
    parsed=true;
    if(phase?.format==='sila-na-trase-ai-v1')return phase;
  }
  if(parsed)throw Error('JSON ma inny format. Poproś ChatGPT o ponowne przygotowanie fazy w formacie sila-na-trase-ai-v1.');
  if(/^"[^"\r\n]+"\s*:/.test(source)||(/"format"\s*:\s*"sila-na-trase-ai-v1"/.test(source)&&!/\}\s*(?:```)?$/.test(source))) {
    throw Error('Wklejony fragment JSON jest niekompletny. W ChatGPT użyj przycisku „Kopiuj” przy całym bloku kodu lub pobierz plik. Potrzebny jest cały tekst od otwierającej klamry przed polem „format” do ostatniej klamry zamykającej.');
  }
  throw Error('W odpowiedzi brakuje poprawnego JSON. Poproś ChatGPT: „Zwróć ten trening jako kompletny JSON w formacie sila-na-trase-ai-v1 z poprzedniego promptu”. Następnie wklej odpowiedź tutaj.');
}

const nameKey=name=>name.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('pl');

export function importTrainingPhase(state,profileId,phase) {
  if(state.activeProfileId!==profileId)throw Error('Profil się zmienił. Sprawdź plan ponownie.');
  const name=text(phase.name,'Nazwa fazy',60,true);
  const weeks=integer(phase.weeks,'Liczba tygodni',1);
  if(weeks>52)throw Error('Faza może mieć maksymalnie 52 tygodnie.');
  if(!Array.isArray(phase.sessions)||!phase.sessions.length||phase.sessions.length>100)throw Error('Faza musi zawierać od 1 do 100 sesji.');
  const coveredWeeks=new Set();
  const plans=phase.sessions.map((session,index)=>{
    if(!session||!Array.isArray(session.exercises)||!session.exercises.length||session.exercises.length>30)throw Error(`Sesja ${index+1} musi zawierać od 1 do 30 ćwiczeń.`);
    const from=integer(session.week_from,'Tydzień od',1),to=integer(session.week_to,'Tydzień do',from);
    if(to>weeks)throw Error(`Sesja ${index+1} wykracza poza zakres fazy.`);
    for(let week=from;week<=to;week++)coveredWeeks.add(week);
    const sessionName=text(session.name,'Nazwa sesji',60,true);
    const plan=createCustomPlan(state,profileId,{name:`${name} · Tydz. ${from===to?from:`${from}–${to}`} · ${sessionName}`});
    for(const item of session.exercises){
      if(!item||!['reps','time'].includes(item.mode))throw Error(`${sessionName}: wybierz tryb ćwiczenia „reps” lub „time”.`);
      const exerciseName=text(item.name,'Nazwa ćwiczenia',160,true);
      let exercise=state.exercises.find(ex=>!ex.archived&&nameKey(ex.name)===nameKey(exerciseName));
      if(exercise&&exercise.mode!==item.mode)throw Error(`Ćwiczenie „${exerciseName}” ma w bibliotece inny tryb. Popraw plik lub zmień nazwę wariantu.`);
      if(!exercise)exercise=addExercise(state,{name:exerciseName,mode:item.mode,load_notation:item.load_notation??'Łączny dodatkowy ciężar w kg'});
      addCustomPlanItem(state,plan.id,{exercise_id:exercise.id,sets_min:item.sets,reps_min:item.reps,reps_max:item.reps_max,seconds:item.seconds,
        rest_seconds:item.rest_seconds,basis:item.basis,percent_min:item.percent,percent_max:item.percent_max,fixed_weight:item.fixed_weight,tempo:item.tempo,notes:item.notes});
    }
    return plan;
  });
  if(coveredWeeks.size!==weeks)throw Error('Przypisz sesje do każdego tygodnia fazy.');
  return {name,weeks,plans};
}
