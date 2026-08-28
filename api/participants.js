import { requireAdmin } from '../lib/auth.js';

const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function config() { const url = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? { url, key } : null; }
function headers(key, extra = {}) { return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }; }
const gateTemplates = [
  [0,'privacy_consent','Datenschutz aktiv bestätigt'],[0,'start_commitment','Start-Commitment unterschrieben'],
  [1,'three_wishes','Drei Wünsche vertieft'],[1,'target_and_baseline','Zielzustand und Klarheits-Baseline'],[1,'career_history','Werdegang vollständig'],
  [2,'skills','Formales und informelles Können'],[2,'self_external_view','Selbst- und Fremdbild'],[2,'current_goal','Aktuelles Ziel'],
  [3,'motivators','Top 5 Motivatoren'],[3,'childhood','Kindheitsinteressen'],[3,'reintegration','Reintegration gewählt'],
  [4,'human_design','Human Design technisch verarbeitet'],[4,'puzzle_assignment','Ding/Leben-Zuordnung'],[4,'midpoint_report','Halbzeitbericht erzeugt'],
  [5,'values','Top 5 Werte'],[5,'lila','LILA abgeschlossen'],[5,'eulogy','Grabrede hochgeladen'],
  [6,'four_areas','Vier FDD-Bereiche'],[6,'exclusion_criteria','Mindestens 10 Ausschlusskriterien'],[6,'ding_map','Positivkriterien und Dein-Ding-Map'],
  [7,'reality_contact','Mindestens ein Realitätskontakt'],[7,'final_two','Genau zwei Optionen'],[7,'decision_or_escalation','Entscheidung oder Coach-Eskalation'],
  [8,'implementation_plan','24/30/90-Tage-Plan'],[8,'final_commitment','Umsetzungs-Commitment'],[8,'dossier_and_call','Dossier und Abschlusscall'],
];

export default async function handler(request, response) {
  if (!requireAdmin(request, response)) return;
  const service = config();
  if (!service) return response.status(503).json({ error: 'Supabase ist noch nicht konfiguriert.' });
  if (request.method === 'GET') {
    const result = await fetch(`${service.url}/rest/v1/user_profiles?role=eq.participant&select=*,participant_progress(*)&order=created_at.desc`, { headers: headers(service.key) });
    const participants = await result.json();
    return response.status(result.status).json(result.ok ? { participants } : { error: participants.message });
  }
  if (request.method === 'POST') {
    const name = clean(request.body?.name, 120), email = clean(request.body?.email, 254).toLowerCase();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: 'Name und gültige E-Mail sind erforderlich.' });
    const created = await fetch(`${service.url}/rest/v1/user_profiles`, { method: 'POST', headers: headers(service.key, { Prefer: 'return=representation' }), body: JSON.stringify({ name, email, role: 'participant', status: 'invited' }) });
    const profiles = await created.json();
    if (!created.ok) return response.status(created.status).json({ error: profiles.message });
    await Promise.all([
      fetch(`${service.url}/rest/v1/participant_progress`, { method: 'POST', headers: headers(service.key), body: JSON.stringify({ user_profile_id: profiles[0].id, process_status: 'ONBOARDING', current_week: 0 }) }),
      fetch(`${service.url}/rest/v1/week_gates`, { method: 'POST', headers: headers(service.key), body: JSON.stringify(gateTemplates.map(([week, gate_key, label]) => ({ user_profile_id: profiles[0].id, week, gate_key, label }))) }),
    ]);
    return response.status(201).json({ participant: profiles[0] });
  }
  return response.status(405).json({ error: 'Methode nicht erlaubt.' });
}
