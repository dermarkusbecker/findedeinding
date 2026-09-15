async function api(method='GET',body) {
 const response=await fetch('/api/participant-program?feature=login-clarity',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json(); if(!response.ok)throw Error(data.error||'Klarheits-Check konnte nicht geladen werden.');return data;
}
function renderHistory(history) {
 let card=document.querySelector('#loginClarityHistory');
 if(!card){card=document.createElement('section');card.id='loginClarityHistory';card.className='login-clarity-history';document.querySelector('[data-panel="insights"] .insight-grid')?.before(card);}
 card.replaceChildren();const title=document.createElement('h2');title.textContent='Deine Klarheit bei jedem Login';card.append(title);
 const copy=document.createElement('p');copy.textContent='Deine Momentaufnahmen – zusätzlich zu den acht Wochen-Check-ins.';card.append(copy);
 const list=document.createElement('div');list.className='login-history-points';
 for(const item of history.slice(0,20).reverse()){const point=document.createElement('div');const score=document.createElement('strong');score.textContent=`${item.score} / 10`;const time=document.createElement('time');time.textContent=new Date(item.created_at).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});point.append(score,time);list.append(point);}card.append(list);
}
export async function openLoginClarity() {
 const data=await api();renderHistory(data.history);if(!data.required)return;
 const previous=data.history[0]?.score??null;
 const dialog=document.createElement('dialog');dialog.className='holo-checkin';dialog.setAttribute('aria-labelledby','holoTitle');
 dialog.innerHTML=`<div class="holo-network" aria-hidden="true"><svg viewBox="0 0 1000 700" preserveAspectRatio="none"><path d="M0 90L180 90 290 200 710 200 820 90 1000 90M0 600L180 600 290 490 710 490 820 600 1000 600M80 0V140L210 270V440L80 570V700M920 0V140L790 270V440L920 570V700M0 350H1000M500 0V700"/>${[[180,90],[290,200],[710,200],[820,90],[180,600],[290,490],[710,490],[820,600],[210,270],[790,440]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="5"/>`).join('')}</svg></div><form class="holo-console"><p class="holo-label">CLARA · KLARHEITS-CHECK</p><h2 id="holoTitle">Dein Moment.<br>Deine Klarheit.</h2><p class="holo-copy">Wie klar ist dir heute, was wirklich dein Ding ist? Jede ehrliche Antwort zählt.</p><fieldset><legend>Wähle deinen Wert von 1 bis 10</legend><div class="holo-scale">${Array.from({length:10},(_,i)=>`<label><input type="radio" name="score" value="${i+1}" required><span>${i+1}</span></label>`).join('')}</div><div class="holo-endpoints"><span>1 · Noch völlig unklar</span><span>10 · Glasklar</span></div></fieldset><label class="holo-reason" hidden>Was glaubst du, warum deine Klarheit heute niedriger ist?<textarea name="note" maxlength="3000" placeholder="Auch Unsicherheit darf hier Platz haben."></textarea></label><p class="holo-status" role="status"></p><button class="holo-save" type="submit">Klarheit speichern →</button><button class="holo-later" type="button">Später einschätzen</button></form>`;
 document.body.append(dialog);dialog.showModal();
 const close=()=>{dialog.close();dialog.remove();};dialog.querySelector('.holo-later').onclick=close;dialog.addEventListener('cancel',()=>setTimeout(()=>dialog.remove(),0));
 const form=dialog.querySelector('form'),reason=dialog.querySelector('.holo-reason'),status=dialog.querySelector('.holo-status'),save=dialog.querySelector('.holo-save');
 form.addEventListener('change',()=>{reason.hidden=previous===null||Number(form.elements.score.value)>=previous;form.elements.note.required=!reason.hidden;});
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;status.textContent='Dein Wert wird gespeichert …';try{const result=await api('POST',{score:Number(form.elements.score.value),note:form.elements.note.value});const history=[result.saved,...data.history.filter(item=>item.id!==result.saved.id)];renderHistory(history);window.dispatchEvent(new CustomEvent('fdd:clarity-saved',{detail:result.saved}));status.textContent='Gespeichert. Danke für deine ehrliche Einschätzung.';save.textContent='Weiter zu deinem Bereich →';save.disabled=false;form.onsubmit=e=>{e.preventDefault();close();};form.querySelector('fieldset').disabled=true;dialog.classList.add('is-saved');}catch(error){status.textContent=error.message;save.disabled=false;}};
}
