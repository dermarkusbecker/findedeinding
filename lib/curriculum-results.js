import { curriculumWeekProgress } from './curriculum-week-progress.js';
import { completedCurriculumWeeks } from './curriculum-runtime.js';
export function curriculumReflection(definition, records, week) {
 const w=definition.weeks[week-1];
 if(!completedCurriculumWeeks(definition,records).includes(week))return null;
 const rows=w.steps.map(s=>records.find(r=>r.step_id===s.id)).filter(Boolean);
 const final=rows.at(-1);
 return {week,title:(w.output||w.title).split(':')[0],summary:final?.summary||'',highlights:rows.slice(0,-1).map(r=>r.summary).filter(Boolean),development:'',nextImpulse:definition.weeks[week]?.intro||'Dein nächster Schritt steht in deinem 90-Tage-Plan.',closing:'',createdAt:final?.updated_at,structuredData:rows.map(r=>({lesson:w.steps.find(s=>s.id===r.step_id)?.title,data:r.structured_data,signals:r.signals}))};
}
export function curriculumProcessWeeks(result) {
 const definition=result.processVersion.definition,records=result.curriculum||[];
 return definition.weeks.map((w,i)=>{
 const week=i+1,access=result.serializedAccess.weekStates.find(s=>s.week===week)||{},rows=records.filter(r=>r.week===week&&!r.step_id.startsWith('week_complete_')),completed=completedCurriculumWeeks(definition,records).includes(week);
 return {week,progressPercent:curriculumWeekProgress(definition,records,week,completed),title:w.title,mode:w.mode,stateStatus:completed?'completed':rows.length?'in_progress':'not_started',currentStep:w.steps.find(s=>!rows.some(r=>r.step_id===s.id&&r.status==='completed'))?.title||null,updatedAt:rows.at(-1)?.updated_at||null,completedAt:completed?rows.at(-1)?.updated_at:null,accessible:Boolean(access.accessible),completed,reason:access.reason,unlocksAt:access.unlocksAt,answers:rows.map(r=>({key:r.step_id,label:w.steps.find(s=>s.id===r.step_id)?.title||r.step_id,question:w.steps.find(s=>s.id===r.step_id)?.question||'',value:(r.messages||[]).filter(m=>m.role==='user').map(m=>m.content).join('\n\n'),status:r.status,summary:r.summary,structuredData:r.structured_data,signals:r.signals})),reflection:curriculumReflection(definition,records,week)};
 });
}
export function curriculumTechnicalResults(result){return result.processVersion.definition.weeks.flatMap((w,i)=>w.steps.filter(s=>s.kind==='external').map(s=>{const record=result.curriculum.find(r=>r.step_id===s.id),previous=w.steps.slice(0,w.steps.indexOf(s));return {week:i+1,stepId:s.id,title:s.title,external:s.external,status:record?.status==='completed'?'confirmed':Number(result.access.processWeek)===i+1&&previous.every(p=>p.optional||result.curriculum.some(r=>r.step_id===p.id&&r.status==='completed'))?'pending':'not_reached',confirmation:record?.structured_data||null};}));}
