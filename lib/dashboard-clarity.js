import {clarityRecordedAt} from './current-clarity.js';
const valid=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=10;
const average=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
export function dashboardClarity(entries, accessMap, logins=[]) {
 const latest=new Map();
 for(const entry of [...entries].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))){
  const key=`${entry.user_profile_id}:${entry.week}`;
  if(!latest.has(key))latest.set(key,entry);
 }
 const histories=[];
 for(const [id,access] of accessMap){
  const scores=[];
  for(const week of access.automaticUnlockedWeeks||[]){
   const state=latest.get(`${id}:${week}`)?.structured_data?.[`week_${week}`];
   const point=Number(week)===1?state?.clarity_baseline:state?.clarity_checkin;
   if(point?.completed&&valid(point.score))scores.push({week:Number(week),score:Number(point.score),recordedAt:point.recorded_at||clarityRecordedAt(entries.filter(e=>e.user_profile_id===id),week,point.score)});
  }
  scores.sort((a,b)=>a.week-b.week);
  const login=logins.filter(p=>p.user_profile_id===id&&valid(p.score)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  if(login&&(!scores.length||new Date(login.created_at)>new Date(scores.at(-1).recordedAt||0)))scores.push({week:0,score:Number(login.score)});
  histories.push(scores);
 }
 const gains=histories.filter(scores=>scores[0]?.week===1&&scores.length>1).map(scores=>scores.at(-1).score-scores[0].score);
 return {averageGain:average(gains),completedComparisons:gains.length,comparisonBasis:'start_latest',phases:[['start',1],['midpoint',4],['end',8]].map(([phase,week])=>{const values=histories.flatMap(scores=>scores.filter(point=>point.week===week).map(point=>point.score));return {phase,average:average(values),count:values.length};})};
}
