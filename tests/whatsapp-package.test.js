import test from 'node:test';
import assert from 'node:assert/strict';
import {whatsappPackageStatus,requireWhatsAppPackage} from '../lib/whatsapp-package.js';
test('Meta credentials alone do not unlock the paid WhatsApp extension',()=>{
 const env={WHATSAPP_ACCESS_TOKEN:'test-token',WHATSAPP_PHONE_NUMBER_ID:'test-phone'};
 assert.deepEqual(whatsappPackageStatus(env),{enabled:false,configured:false,provider:'Meta WhatsApp Cloud API'});
 assert.throws(()=>requireWhatsAppPackage(env),e=>e.status===403&&/InnovationsHelden von NEX Consulting/.test(e.message));
});
test('explicit package activation is separate from connection readiness',()=>{
 assert.equal(whatsappPackageStatus({WHATSAPP_BUSINESS_PACKAGE_ENABLED:'true'}).configured,false);
 const env={WHATSAPP_BUSINESS_PACKAGE_ENABLED:'true',WHATSAPP_ACCESS_TOKEN:'test-token',WHATSAPP_PHONE_NUMBER_ID:'test-phone'};
 assert.equal(whatsappPackageStatus(env).configured,true);assert.doesNotThrow(()=>requireWhatsAppPackage(env));
 assert.throws(()=>requireWhatsAppPackage({...env,WHATSAPP_BUSINESS_PACKAGE_ENABLED:'false'}));
});
