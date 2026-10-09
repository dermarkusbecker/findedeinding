export async function automationTemplate(service, key, tokens, fallback) {
  const secret = service.key || service.serviceKey;
  const response = await fetch(`${service.url}/rest/v1/communication_templates?template_key=eq.${encodeURIComponent(key)}&status=eq.active&select=subject,body&limit=1`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(`Die E-Mail-Vorlage ${key} konnte nicht geladen werden.`);
  const [template] = await response.json();
  const render = value => String(value || '').replace(/{{([a-z_]+)}}/gi, (_, token) => String(tokens[token] ?? ''));
  return {
    subject: render(template?.subject || fallback.subject),
    body: render(template?.body || fallback.body),
  };
}
