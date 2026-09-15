export function validatedCurriculumInput(lesson, body) {
 const input=body.input;
 if(['selection','priority_selection'].includes(lesson.kind)){
  if(!Array.isArray(input)||new Set(input).size!==input.length||input.length<lesson.minItems||input.length>lesson.maxItems||input.some(value=>!lesson.options.includes(value)))throw Error(`Bitte ${lesson.minItems===lesson.maxItems?'genau '+lesson.minItems:lesson.minItems+' bis '+lesson.maxItems} unterschiedliche Einträge auswählen.`);
  return {content:input.map((value,index)=>`${index+1}. ${value}`).join('\n'),data:{selection:input}};
 }
 if(lesson.kind==='scale'){
  if(!Number.isInteger(input)||input<lesson.min||input>lesson.max)throw Error('Bitte einen gültigen Skalenwert auswählen.');
  return {content:String(input),data:{score:input}};
 }
 if(lesson.kind==='confirmation'){
  if(input!==true)throw Error('Bitte bewusst bestätigen.');
  return {content:lesson.expected,data:{confirmed:true}};
 }
 const content=String(body.content||'').trim();
 if(!content||content.length>12000)throw Error('Bitte eine Antwort mit maximal 12.000 Zeichen eingeben.');
 return {content,data:null};
}
