const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderBrandedEmail({subject='',body='',signature=null,branding={},origin='https://findedeinding.vercel.app'}={}) {
  const brand=branding.brand_name||'Finde dein Ding';
  let logo='';
  try { const url=new URL(branding.logo_url||'/assets/fdd-logo.png',origin); if(['https:','http:'].includes(url.protocol)) { if(url.pathname==='/assets/fdd-logo.svg')url.pathname='/assets/fdd-logo.png';logo=url.href; } } catch {}
  const active=signature&&signature.active!==false;
  const lines=active?[signature.closing_text||'Herzliche Grüße','',signature.signer_name,signature.role_title,signature.company_name,signature.email,signature.phone,signature.website].filter(value=>value!==null&&value!==undefined):[];
  const text=[body,lines.join('\n')].filter(Boolean).join('\n\n');
  const paragraphs=escape(body).split(/\n\s*\n/).map(part=>`<p style="margin:0 0 20px">${part.replace(/\n/g,'<br>')}</p>`).join('');
  const signatureHtml=active?`<div style="margin-top:30px"><p>${escape(signature.closing_text||'Herzliche Grüße')}</p><div style="border-left:3px solid #ff9453;padding-left:18px"><strong style="font-size:19px">${escape(signature.signer_name)}</strong>${[signature.role_title,signature.company_name,signature.email,signature.phone,signature.website].filter(Boolean).map(value=>`<div>${escape(value)}</div>`).join('')}</div></div>`:'';
  const logoHtml=logo&&(!active||signature.use_system_logo!==false)?`<img src="${escape(logo)}" alt="${escape(brand)}" width="260" style="display:block;width:260px;max-width:100%;height:auto">`:`<strong style="color:#ff9453;font-size:24px">${escape(brand)}</strong>`;
  const html=`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#edf3f5;color:#244957;font:16px/1.65 Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border:1px solid #d3e1e7"><tr><td style="background:#103344;padding:28px;border-bottom:4px solid #ff9453">${logoHtml}</td></tr><tr><td style="padding:28px;overflow-wrap:anywhere"><h1 style="font-size:23px;line-height:1.35;margin:0 0 26px">${escape(subject)}</h1>${paragraphs}${signatureHtml}</td></tr><tr><td style="padding:18px 28px;background:#f5f8f9;color:#617984;font-size:12px">${escape(brand)} · Finde, was wirklich zu dir passt.</td></tr></table></td></tr></table></body></html>`;
  return {html,text};
}
