const serviceHeaders = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  ...extra,
});

const clean = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function splitContactName(value = '') {
  const parts = clean(value, 160).split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

async function parsed(response, fallback) {
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || fallback), { status: response.status });
  return data;
}

export async function syncLeadToCustomerProfile(service, lead) {
  if (!lead?.converted_user_profile_id) return null;
  const key = service.key || service.serviceKey;
  const rows = await parsed(await fetch(`${service.url}/rest/v1/user_profiles?id=eq.${encodeURIComponent(lead.converted_user_profile_id)}&role=eq.user`, {
    method: 'PATCH',
    headers: serviceHeaders(key, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      source_lead_id: lead.id,
      name: clean(lead.name, 160),
      phone: clean(lead.phone, 40) || null,
      mobile_phone: clean(lead.mobile_phone || lead.phone, 40) || null,
      whatsapp_phone: clean(lead.whatsapp_phone || (lead.whatsapp_same_as_mobile !== false ? lead.mobile_phone : ''), 40) || null,
      whatsapp_same_as_mobile: lead.whatsapp_same_as_mobile !== false,
    }),
  }), 'Die verknüpfte Kundenakte konnte nicht synchronisiert werden.');
  return rows[0] || null;
}

export async function syncCustomerProfileToLead(service, profile) {
  if (!profile?.id) return null;
  const key = service.key || service.serviceKey;
  const filter = profile.source_lead_id
    ? `id=eq.${encodeURIComponent(profile.source_lead_id)}`
    : `converted_user_profile_id=eq.${encodeURIComponent(profile.id)}`;
  const { firstName, lastName } = splitContactName(profile.name);
  const rows = await parsed(await fetch(`${service.url}/rest/v1/leads?${filter}`, {
    method: 'PATCH',
    headers: serviceHeaders(key, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      converted_user_profile_id: profile.id,
      status: 'customer',
      name: clean(profile.name, 160),
      first_name: firstName || null,
      last_name: lastName || null,
      email: clean(profile.email, 254).toLowerCase(),
      phone: clean(profile.phone, 40) || null,
      mobile_phone: clean(profile.mobile_phone || profile.phone, 40) || null,
      whatsapp_phone: clean(profile.whatsapp_phone || (profile.whatsapp_same_as_mobile !== false ? profile.mobile_phone : ''), 40) || null,
      whatsapp_same_as_mobile: profile.whatsapp_same_as_mobile !== false,
      updated_at: new Date().toISOString(),
    }),
  }), 'Die ursprüngliche Interessentenakte konnte nicht synchronisiert werden.');
  return rows[0] || null;
}
