import { requireCurrentAdmin, supabaseAuthConfig } from '../lib/user-auth.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uuidValid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
const TEMPLATE_CATEGORIES = ['general', 'lead', 'appointment', 'contract', 'participant', 'program'];
const CAMPAIGN_AUDIENCES = ['all', 'leads', 'customers', 'selected'];
const AUTOMATION_TRIGGERS = ['lead_created', 'appointment_scheduled', 'contract_signed', 'participant_activated', 'week_unlocked', 'inactivity'];

function serviceConfig() {
  const auth = supabaseAuthConfig();
  return auth ? { ...auth, key: auth.serviceKey } : null;
}

const headers = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

async function readJson(result, fallback = 'Kommunikations-Center konnte nicht verarbeitet werden.') {
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw Object.assign(new Error(data.message || data.msg || data.error || fallback), { status: result.status });
  return data;
}

async function list(service, table, query) {
  return readJson(await fetch(`${service.url}/rest/v1/${table}?${query}`, { headers: headers(service.key) }));
}

async function insert(service, table, payload) {
  const rows = await readJson(await fetch(`${service.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(service.key, { Prefer: 'return=representation' }),
    body: JSON.stringify(payload),
  }));
  return rows[0] || null;
}

async function update(service, table, id, payload) {
  if (!uuidValid(id)) throw Object.assign(new Error('Gültige Datensatz-ID fehlt.'), { status: 400 });
  const rows = await readJson(await fetch(`${service.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers(service.key, { Prefer: 'return=representation' }),
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
  }));
  if (!rows[0]) throw Object.assign(new Error('Datensatz wurde nicht gefunden.'), { status: 404 });
  return rows[0];
}

async function contacts(service) {
  const rows = await list(service, 'leads', 'select=id,name,email,status,converted_user_profile_id&order=name.asc&limit=1000');
  return rows.map((lead) => ({
    id: lead.id,
    name: lead.name,
    email: lead.email,
    type: lead.converted_user_profile_id ? 'customer' : 'lead',
    status: lead.status,
  }));
}

function audienceContacts(allContacts, audienceType, selectedIds = []) {
  if (audienceType === 'leads') return allContacts.filter((item) => item.type === 'lead');
  if (audienceType === 'customers') return allContacts.filter((item) => item.type === 'customer');
  if (audienceType === 'selected') {
    const selected = new Set(selectedIds.filter(uuidValid));
    return allContacts.filter((item) => selected.has(item.id));
  }
  return allContacts;
}

async function communicationCenter(service) {
  const [templates, campaigns, automations, allContacts] = await Promise.all([
    list(service, 'communication_templates', 'status=neq.archived&select=*&order=updated_at.desc'),
    list(service, 'communication_campaigns', 'select=*&order=created_at.desc&limit=200'),
    list(service, 'communication_automations', 'select=*&order=created_at.desc&limit=200'),
    contacts(service),
  ]);
  return {
    templates,
    campaigns,
    automations,
    contacts: allContacts,
    audience: {
      all: allContacts.length,
      leads: allContacts.filter((item) => item.type === 'lead').length,
      customers: allContacts.filter((item) => item.type === 'customer').length,
    },
    summary: {
      templates: templates.length,
      activeTemplates: templates.filter((item) => item.status === 'active').length,
      campaigns: campaigns.length,
      scheduledCampaigns: campaigns.filter((item) => item.status === 'scheduled').length,
      automations: automations.length,
      activeAutomations: automations.filter((item) => item.enabled).length,
    },
    mailTransport: { active: false, provider: null, label: 'Domain-Mail-Schnittstelle geplant' },
  };
}

function templatePayload(body) {
  const name = clean(body?.name, 140);
  const subject = clean(body?.subject, 220);
  const content = clean(body?.body, 20000);
  if (!name || !subject || !content) throw Object.assign(new Error('Name, Betreff und Vorlageninhalt sind erforderlich.'), { status: 400 });
  return {
    name,
    description: clean(body?.description, 400) || null,
    category: TEMPLATE_CATEGORIES.includes(body?.category) ? body.category : 'general',
    channel: body?.channel === 'whatsapp' ? 'whatsapp' : 'email',
    subject,
    body: content,
    status: body?.status === 'active' ? 'active' : 'draft',
  };
}

async function saveTemplate(service, body) {
  const payload = templatePayload(body);
  return uuidValid(body?.id) ? update(service, 'communication_templates', body.id, payload) : insert(service, 'communication_templates', payload);
}

async function saveCampaign(service, body) {
  const name = clean(body?.name, 140);
  const subject = clean(body?.subject, 220);
  const content = clean(body?.body, 20000);
  const audienceType = CAMPAIGN_AUDIENCES.includes(body?.audienceType) ? body.audienceType : 'leads';
  const selectedLeadIds = Array.isArray(body?.selectedLeadIds) ? body.selectedLeadIds.filter(uuidValid).slice(0, 1000) : [];
  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;
  if (!name || !subject || !content) throw Object.assign(new Error('Name, Betreff und Nachricht sind erforderlich.'), { status: 400 });
  if (body?.status === 'scheduled' && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw Object.assign(new Error('Für eine geplante Seriennachricht ist ein gültiger Versandzeitpunkt erforderlich.'), { status: 400 });
  if (audienceType === 'selected' && !selectedLeadIds.length) throw Object.assign(new Error('Bitte mindestens einen Kontakt auswählen.'), { status: 400 });
  const recipients = audienceContacts(await contacts(service), audienceType, selectedLeadIds);
  const payload = {
    name,
    template_id: uuidValid(body?.templateId) ? body.templateId : null,
    audience_type: audienceType,
    audience_filter: audienceType === 'selected' ? { leadIds: selectedLeadIds } : {},
    recipient_count: recipients.length,
    subject,
    body: content,
    scheduled_at: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt.toISOString() : null,
    status: body?.status === 'scheduled' ? 'scheduled' : 'draft',
  };
  return uuidValid(body?.id) ? update(service, 'communication_campaigns', body.id, payload) : insert(service, 'communication_campaigns', payload);
}

async function saveAutomation(service, body) {
  const name = clean(body?.name, 140);
  const triggerType = AUTOMATION_TRIGGERS.includes(body?.triggerType) ? body.triggerType : '';
  const templateId = clean(body?.templateId, 80);
  const delayValue = Math.max(0, Math.min(365, Number.parseInt(body?.delayValue, 10) || 0));
  if (!name || !triggerType || !uuidValid(templateId)) throw Object.assign(new Error('Name, Auslöser und Vorlage sind erforderlich.'), { status: 400 });
  const payload = {
    name,
    trigger_type: triggerType,
    trigger_config: triggerType === 'week_unlocked' ? { week: Math.max(1, Math.min(8, Number.parseInt(body?.week, 10) || 1)) } : triggerType === 'inactivity' ? { inactiveDays: Math.max(1, Math.min(90, Number.parseInt(body?.inactiveDays, 10) || 3)) } : {},
    delay_value: delayValue,
    delay_unit: ['minutes', 'hours', 'days'].includes(body?.delayUnit) ? body.delayUnit : 'hours',
    send_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(body?.sendTime || '') ? `${body.sendTime}:00` : null,
    template_id: templateId,
    audience_type: ['event_contact', 'leads', 'customers'].includes(body?.audienceType) ? body.audienceType : 'event_contact',
    enabled: body?.enabled === true || body?.enabled === 'true' || body?.enabled === 'on',
  };
  return uuidValid(body?.id) ? update(service, 'communication_automations', body.id, payload) : insert(service, 'communication_automations', payload);
}

export default async function handler(request, response) {
  const service = serviceConfig();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  const admin = await requireCurrentAdmin(request, response);
  if (!admin) return;
  const action = request.query?.action || request.body?.action || 'center';
  try {
    if (request.method === 'GET' && action === 'center') return response.status(200).json(await communicationCenter(service));
    if (request.method === 'POST' && action === 'template') return response.status(200).json({ record: await saveTemplate(service, request.body), message: 'Nachrichtenvorlage wurde gespeichert.' });
    if (request.method === 'POST' && action === 'campaign') return response.status(200).json({ record: await saveCampaign(service, request.body), message: request.body?.status === 'scheduled' ? 'Seriennachricht wurde geplant und wartet bis zur Mail-Anbindung auf den Versand.' : 'Seriennachricht wurde als Entwurf gespeichert.' });
    if (request.method === 'POST' && action === 'automation') return response.status(200).json({ record: await saveAutomation(service, request.body), message: 'Automatisierte Nachricht wurde gespeichert.' });
    if (request.method === 'PATCH' && action === 'campaign-state') {
      const status = ['draft', 'scheduled', 'paused', 'cancelled'].includes(request.body?.status) ? request.body.status : 'draft';
      return response.status(200).json({ record: await update(service, 'communication_campaigns', request.body?.id, { status }) });
    }
    if (request.method === 'PATCH' && action === 'automation-state') {
      return response.status(200).json({ record: await update(service, 'communication_automations', request.body?.id, { enabled: request.body?.enabled === true }) });
    }
    return response.status(405).json({ error: 'Aktion oder Methode nicht erlaubt.' });
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || 'Kommunikations-Center konnte nicht verarbeitet werden.' });
  }
}
