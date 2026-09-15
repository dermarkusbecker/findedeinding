import {curriculumQuery,completedCurriculumWeeks} from './curriculum-runtime.js';
import {reconcileProgramPosition,isOnboardingComplete} from './program-access.js';
export async function readCurriculumIndex(service){
 const assigned=await curriculumQuery(service,'participant_program_versions?select=user_profile_id,version_id&limit=10000');
 const ids=[...new Set(assigned.map(row=>row.version_id).filter(Boolean))];if(!ids.length)return new Map();
 const versions=await curriculumQuery(service,`program_versions?id=in.(${ids.join(',')})&select=id,version,engine:definition->>engine,weeks:definition->weeks`);
 const byId=new Map(versions.filter(row=>row.engine==='curriculum_4plus4').map(row=>[row.id,{version:row.version,definition:{engine:row.engine,weeks:row.weeks}}]));
 if(!byId.size)return new Map();
 const records=await curriculumQuery(service,'curriculum_lessons?select=user_profile_id,version,week,step_id,status,updated_at&limit=50000');
 return new Map(assigned.filter(row=>byId.has(row.version_id)).map(row=>{const version=byId.get(row.version_id);return [row.user_profile_id,{...version,records:records.filter(r=>r.user_profile_id===row.user_profile_id&&r.version===version.version)}];}));
}
export function curriculumAccess(scheduled,context,progress){
 if(!isOnboardingComplete(progress))return scheduled;
 const access=reconcileProgramPosition(scheduled,completedCurriculumWeeks(context.definition,context.records));
 const ready=context.definition.weeks.flatMap((w,i)=>w.steps.every(s=>s.optional||context.records.some(r=>r.step_id===s.id&&r.status==='completed'))?[i+1]:[]);
 return {...access,gateCompletedWeeks:ready,weekStates:access.weekStates.map(w=>({...w,readyToComplete:ready.includes(w.week)}))};
}
export function curriculumGates(id,context){return context.definition.weeks.flatMap((w,i)=>w.steps.filter(s=>!s.optional).map(s=>({id:`curriculum:${id}:${s.id}`,user_profile_id:id,week:i+1,gate_key:s.id,label:s.title,required:true,completed_at:context.records.find(r=>r.step_id===s.id&&r.status==='completed')?.updated_at||null,read_only:true})));}
