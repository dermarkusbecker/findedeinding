import {curriculumOpening} from './curriculum-opening.js';
import {readStartCommitmentDocument} from './start-commitment.js';
import { validatedCurriculumInput } from './curriculum-input.js';
import {isCurriculum,curriculumQuery,curriculumRecords,respondCurriculum,evidenceStrength,resolveCurriculumTopic} from './curriculum-runtime.js';
export async function handleCurriculum(request,response,session,result){
 const version=result.processVersion?.version,definition=result.processVersion?.definition;
 if(!isCurriculum(definition))return response.status(404).json({error:'Kein 4+4-Curriculum zugeordnet.'});
 const records=result.curriculum || await curriculumRecords(result.service,session.participantId,version);
 if(request.method==='GET'){const cv=await curriculumQuery(result.service,`participant_documents?user_profile_id=eq.${session.participantId}&document_type=eq.cv&select=id,original_file_name&order=created_at.desc&limit=1`);return response.status(200).json({version,definition:request.headers?.['x-fdd-client']?.startsWith('FindeDeinDing-iOS/')?{...definition,weeks:definition.weeks.map(w=>({...w,steps:w.steps.map(step=>({...step,opening:curriculumOpening(step)}))}))}:definition,records,cvDocument:cv[0]||null});}
 if(request.method!=='POST')return response.status(405).json({error:'Methode nicht erlaubt.'});
 if(session.adminPreview)return response.status(403).json({error:'Vorschau ist schreibgeschützt.'});
 const body=request.body||{},week=Number(body.week),w=definition.weeks[week-1];
 const state=result.stateEntries?.find(e=>Number(e.week)===week)?.structured_data?.[`week_${week}`];
 const score=week===1?state?.clarity_baseline?.score:state?.clarity_checkin?.score;
 if(!(Number(score)>=1&&Number(score)<=10))return response.status(409).json({error:'Bitte zuerst den Klarheits-Check-in dieser Woche erfassen.',code:'CLARITY_CHECKIN_REQUIRED'});
 if(!result.progress.privacy_consent_at||!result.progress.start_commitment_at)return response.status(403).json({error:'Bitte zuerst dein Onboarding abschließen.'});
 const cvStepIndex=w?.steps.findIndex(s=>s.id==='c44_w1_l4')??-1;
 if(body.action==='finalize'){
  if(!w||(!result.access.canAccessWeek(week)||week!==Number(result.access.processWeek))||result.access.status==='paused')return response.status(403).json({error:'Woche nicht verfügbar.'});
  if(w.steps.some(s=>!s.optional&&!records.some(r=>r.step_id===s.id&&r.status==='completed')))return response.status(409).json({error:'Bitte zuerst alle Pflichtlektionen bestätigen.'});
 if(cvStepIndex>=0&&(body.action==='finalize'||w.steps.findIndex(s=>s.id===body.stepId)>=cvStepIndex)){
  const cv=await curriculumQuery(result.service,`participant_documents?user_profile_id=eq.${session.participantId}&document_type=eq.cv&select=id&limit=1`);
  if(!cv.length)return response.status(409).json({error:'Bitte lade zuerst deinen Lebenslauf bei „Dein bisheriger Weg“ hoch.',code:'CV_REQUIRED'});
 }
  const record=await curriculumQuery(result.service,'rpc/save_curriculum_lesson','POST',{p_user:session.participantId,p_version:version,p_week:week,p_step:`week_complete_${week}`,p_revision:0,p_payload:{status:'completed',ready:true,messages:[],summary:'Woche abschließend bestätigt.',structured_data:{},signals:[]}});
  return response.status(200).json({record});
 }
 let lesson=w?.steps.find(s=>s.id===body.stepId);
 if(!lesson||(!result.access.canAccessWeek(week)||week!==Number(result.access.processWeek))||result.access.status==='paused'||!result.progress.privacy_consent_at||!result.progress.start_commitment_at)return response.status(403).json({error:'Diese Lektion ist noch nicht verfügbar.'});
 if(lesson.kind==='external')return response.status(403).json({error:'Dieses Ergebnis wird nach fachlicher Prüfung im CRM bestätigt.'});

 const allDone=records.some(r=>r.step_id===`week_complete_${week}`&&r.status==='completed');
 const baseline=result.stateEntries?.find(e=>e.week===1)?.structured_data?.week_1?.clarity_baseline?.score;
 if(!(Number(baseline)>=1&&Number(baseline)<=10))return response.status(409).json({error:'Bitte zuerst deine Klarheit zu Beginn erfassen.',code:'INITIAL_CLARITY_REQUIRED'});
 if(allDone)return response.status(409).json({error:'Diese Woche ist abgeschlossen und schreibgeschützt.'});
 if(w.steps.slice(0,w.steps.indexOf(lesson)).some(s=>!s.optional&&!records.some(r=>r.step_id===s.id&&r.status==='completed')))return response.status(409).json({error:'Bitte zuerst die vorherige Lektion abschließen.'});
 if(body.action==='message'&&typeof body.content==='string'&&body.content.trim()&&body.content.length<=12000){
  lesson=await resolveCurriculumTopic({lesson,weekDefinition:w,records:records.filter(r=>r.week===week),content:body.content});
 }
 const existing=records.find(r=>r.step_id===lesson.id);
 const previous=w.steps.slice(0,w.steps.indexOf(lesson));if(previous.some(s=>!s.optional&&!records.some(r=>r.step_id===s.id&&r.status==='completed')))return response.status(409).json({error:'Bitte zuerst die vorherige Lektion abschließen.'});
 if(cvStepIndex>=0&&(body.action==='finalize'||w.steps.findIndex(s=>s.id===lesson.id)>=cvStepIndex)){
  const cv=await curriculumQuery(result.service,`participant_documents?user_profile_id=eq.${session.participantId}&document_type=eq.cv&select=id&limit=1`);
  if(!cv.length)return response.status(409).json({error:'Bitte lade zuerst deinen Lebenslauf bei „Dein bisheriger Weg“ hoch.',code:'CV_REQUIRED'});
 }
 let payload={messages:existing?.messages||[],summary:existing?.summary||'',structured_data:existing?.structured_data||{},signals:existing?.signals||[],status:'draft',ready:false};
 if(body.action==='confirm'){
  if(!existing?.ready)return response.status(409).json({error:'Bitte zuerst die offenen Fragen mit Clara klären.'});
  payload={...payload,status:'completed',ready:true,signals:payload.signals.map(s=>{const next={...s,participant_status:['bestätigt','abgeschwächt','widersprochen','offen'].includes(body.signalStatuses?.[s.signal])?body.signalStatuses[s.signal]:(s.participant_status||'offen')};return {...next,strength:evidenceStrength(next)};})};
 }else if(body.action==='skip'&&lesson.optional){payload={...payload,status:'completed',summary:'Optionalen Reflexionsspiegel übersprungen.',ready:true};}
 else if(body.action==='message'){
  let validated;
  if(lesson.kind==='upload'){
   if(!/^[0-9a-f-]{36}$/i.test(body.input||''))return response.status(400).json({error:'Bitte zuerst eine Datei hochladen.'});
   const documents=await curriculumQuery(result.service,`participant_documents?id=eq.${body.input}&user_profile_id=eq.${session.participantId}&week=eq.${week}&select=id,original_file_name`);
   if(!documents[0])return response.status(403).json({error:'Die Datei gehört nicht zu dieser Kundenwoche.'});
   validated={content:documents[0].original_file_name,data:{documentId:documents[0].id,fileName:documents[0].original_file_name}};
  }else try{validated=validatedCurriculumInput(lesson,body);}catch(error){return response.status(400).json({error:error.message});}
  const {content}=validated;
  const sourceId=`${lesson.id}_${crypto.randomUUID()}`;const messages=[...payload.messages,{role:'user',content,source_id:sourceId}];
  const commitment=validated.data?null:(await readStartCommitmentDocument(result.service,session.participantId))?.extracted_data?.commitment;
  const context=commitment?[{week:0,step_id:'onboarding_commitment',status:'completed',messages:[{role:'user',source_id:'onboarding_commitment',content:[commitment.why,commitment.change,commitment.costOfUnclarity].filter(Boolean).join('\n')}],summary:'Persönliches Commitment und Erwartungen aus dem bestehenden Onboarding.',structured_data:{why:commitment.why,change:commitment.change},signals:[]},...records]:[...records];
  if(lesson.id==='c44_w1_l4'){
   const cv=await curriculumQuery(result.service,`participant_documents?user_profile_id=eq.${session.participantId}&document_type=eq.cv&select=id,extracted_text,extracted_data&order=created_at.desc&limit=1`);
   if(cv[0])context.unshift({week:0,step_id:'required_cv',status:'completed',messages:[{role:'user',source_id:`document_${cv[0].id}`,content:String(cv[0].extracted_text||JSON.stringify(cv[0].extracted_data||{})).slice(0,12000)}],summary:'Lebenslauf als Hintergrund für den bisherigen Weg, keine Berufsdiagnose.',structured_data:{},signals:[]});
  }
  const out=validated.data?{message:'Deine Angaben sind gespeichert. Prüfe sie und bestätige das Ergebnis.',ready:true,summary:content,structured_data:validated.data,signals:[]}:await respondCurriculum({lesson,week,records:context,messages,sourceId});
  payload={...payload,messages:[...messages,{role:'assistant',content:out.message}],summary:out.summary,structured_data:out.structured_data,signals:out.signals,ready:out.ready};
 }else return response.status(400).json({error:'Ungültige Aktion.'});
 const saved=await curriculumQuery(result.service,'rpc/save_curriculum_lesson','POST',{p_user:session.participantId,p_version:version,p_week:week,p_step:lesson.id,p_revision:lesson.id===body.stepId?Number(body.revision||0):Number(existing?.revision||0),p_payload:payload});
 return response.status(200).json({record:saved,records:await curriculumRecords(result.service,session.participantId,version)});
}
