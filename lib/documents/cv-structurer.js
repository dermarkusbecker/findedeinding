import { claraConfig } from '../clara/config.js';
import { CV_EXTRACTION_VERSION } from './cv-extractor.js';

const stationSchema = {
  type: 'object', additionalProperties: false,
  properties: { stations: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, properties: { role: { type: ['string', 'null'] }, company: { type: ['string', 'null'] }, industry: { type: ['string', 'null'] }, from: { type: ['string', 'null'] }, to: { type: ['string', 'null'] }, description_raw: { type: 'string' }, relevant_details: { type: 'array', items: { type: 'string' } } }, required: ['role', 'company', 'industry', 'from', 'to', 'description_raw', 'relevant_details'] } } },
  required: ['stations'],
};

export async function structureCareerHistory(text, { fetchImpl = fetch, env = process.env } = {}) {
  const config = claraConfig(env);
  if (!config.apiKey) throw Object.assign(new Error('Claras KI-Verbindung ist noch nicht konfiguriert.'), { status: 503 });
  const response = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 2200, instructions: 'Extrahiere ausschließlich berufliche und ausbildungsbezogene Stationen aus dem bereitgestellten Lebenslauf. Erfinde nichts. Unbekannte Felder bleiben null. description_raw muss sich eng am Dokument orientieren.', input: text.slice(0, 50000), text: { format: { type: 'json_schema', name: 'career_history', strict: true, schema: stationSchema } }, metadata: { extractor_version: CV_EXTRACTION_VERSION } }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'Lebenslauf konnte nicht strukturiert werden.'), { status: 502 });
  try { return JSON.parse(data.output_text); } catch { throw Object.assign(new Error('Die erkannten Lebenslaufdaten waren ungültig.'), { status: 502 }); }
}
