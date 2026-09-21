export function whatsappPackageStatus(env=process.env){
 const enabled=env.WHATSAPP_BUSINESS_PACKAGE_ENABLED==='true';
 return {enabled,configured:enabled&&Boolean(env.WHATSAPP_ACCESS_TOKEN&&env.WHATSAPP_PHONE_NUMBER_ID),provider:'Meta WhatsApp Cloud API'};
}
export function requireWhatsAppPackage(env=process.env){
 if(!whatsappPackageStatus(env).enabled)throw Object.assign(new Error('WhatsApp Business ist in deinem Paket nicht freigeschaltet. Die Meta-Integration muss separat über ein größeres Paket bei InnovationsHelden von NEX Consulting gebucht werden.'),{status:403});
}
