import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBrandedEmail} from '../lib/branded-email.js';
const signature={active:true,signer_name:'Markus Becker',closing_text:'Herzliche Grüße',email:'markus@example.com',use_system_logo:true};
test('mail uses absolute PNG branding and one signature in HTML and plain text',()=>{
 const mail=renderBrandedEmail({subject:'Dein nächster Schritt',body:'Hallo Alex,\n\nWillkommen.',signature,branding:{logo_url:'/assets/fdd-logo.svg'}});
 assert.match(mail.html,/https:\/\/findedeinding.vercel.app\/assets\/fdd-logo.png/);
 assert.equal(mail.html.split('Herzliche Grüße').length-1,1);
 assert.match(mail.text,/Willkommen\.\n\nHerzliche Grüße/);
});
test('mail escapes content and rejects executable logo URLs',()=>{
 const mail=renderBrandedEmail({subject:'<script>x</script>',body:'<img src=x onerror=alert(1)>',signature:{...signature,signer_name:'<iframe>'},branding:{logo_url:'javascript:alert(1)'}});
 assert.doesNotMatch(mail.html,/<script>|<iframe>|javascript:|<img src=x/);
 assert.match(mail.html,/&lt;iframe&gt;/);
});
test('inactive signature and unchecked logo are honored',()=>{
 assert.doesNotMatch(renderBrandedEmail({signature:{...signature,active:false}}).html,/Markus Becker/);
 assert.doesNotMatch(renderBrandedEmail({signature:{...signature,use_system_logo:false}}).html,/<img/);
});
test('template placeholders remain visible until real recipient data is available',()=>{
 const mail=renderBrandedEmail({body:'Hallo {{vorname}}\n{{login_link}}'});
 assert.match(mail.html,/{{login_link}}/);assert.match(mail.text,/{{vorname}}/);
});
