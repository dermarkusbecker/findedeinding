const form=document.querySelector('#customerLogin'),status=document.querySelector('#status');
const accessType=new URLSearchParams(location.search).get('zugang')==='kunde'?'Kunden':'Teilnehmer';
document.querySelector('#accessType').textContent=`${accessType}portal`;
document.querySelector('#accessPrompt').textContent=accessType==='Kunden'?'Öffne deine persönlichen Unterlagen und deinen Prozess.':'Setze deinen aktiven 8-Wochen-Prozess fort.';
form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='Zugang wird geprüft …';try{const response=await fetch('/api/auth/customer-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await response.json();if(!response.ok)throw new Error(data.error);location.replace('/portal');}catch(error){status.textContent=error.message;button.disabled=false;}});
