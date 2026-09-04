const status = (key, label, tone) => ({ key, label, tone });

const ACTIVE = status('active', 'Aktiv', 'positive');
const READY = status('ready', 'Bereit zur Verbindung', 'warning');
const MISSING = status('missing', 'Konfiguration fehlt', 'danger');
const PLANNED = status('planned', 'Geplant', 'neutral');

export function buildSystemRegistry({ googleConfigured = false, googleConnection = null, openaiConfigured = false, openaiModel = 'gpt-5.6-terra', whatsappConfigured = false, checkedAt = new Date().toISOString() } = {}) {
  const googleState = googleConnection ? ACTIVE : googleConfigured ? READY : MISSING;
  const aiState = openaiConfigured ? ACTIVE : MISSING;
  const googleDetail = googleConnection
    ? `Verbunden mit ${googleConnection.connected_email || 'Google Workspace'}`
    : googleConfigured
      ? 'OAuth ist vorbereitet; die Verbindung muss noch bestätigt werden.'
      : 'Google Client-ID und Secret müssen hinterlegt werden.';
  const aiDetail = openaiConfigured
    ? `Modell ${openaiModel} ist für die KI-Funktionen konfiguriert.`
    : 'Der OpenAI API-Schlüssel muss hinterlegt werden.';

  const integrations = [
    {
      id: 'supabase', name: 'Supabase', icon: 'S', category: 'Datenbank & Auth',
      purpose: 'Speichert CRM-, Lead-, Teilnehmer- und Prozessdaten und verwaltet sichere Zugänge.',
      detail: 'Diese Systemprüfung wurde über die aktive Supabase-Verbindung geladen.', status: ACTIVE,
    },
    {
      id: 'openai', name: 'OpenAI', icon: 'AI', category: 'KI-Plattform',
      purpose: 'Versorgt Clara, Situationsanalyse und Dokumentstrukturierung mit KI-Funktionen.',
      detail: aiDetail, status: aiState,
    },
    {
      id: 'google_calendar', name: 'Google Kalender', icon: '31', category: 'Terminplanung',
      purpose: 'Prüft Verfügbarkeiten und synchronisiert Kundengespräche mit dem CRM.',
      detail: googleDetail, status: googleState, action: 'google-connect',
    },
    {
      id: 'google_meet', name: 'Google Meet', icon: 'M', category: 'Videogespräche',
      purpose: 'Erstellt für gebuchte Kundengespräche automatisch einen geschützten Meet-Link.',
      detail: googleConnection ? 'Über die aktive Google-Kalender-Verbindung einsatzbereit.' : googleDetail,
      status: googleState, action: 'google-connect',
    },
    {
      id: 'supabase_auth_mail', name: 'Zugangs-Mail', icon: '@', category: 'Systemkommunikation',
      purpose: 'Versendet sichere Einmal-Links zur ersten Passwortvergabe und bei Kundenanfragen.',
      detail: 'Aktuell über Supabase Auth aktiv; der Versand wird später auf die Domain-Mail umgestellt.', status: ACTIVE,
    },
    {
      id: 'domain_email', name: 'Domain-Mailversand', icon: 'M', category: 'Kommunikation',
      purpose: 'Übernimmt später Zugangsmails sowie den ein- und ausgehenden CRM-Mailverkehr über die eigene Domain.',
      detail: 'Der Domain-Anbieter und die Zugangsdaten werden später als Schnittstelle ergänzt.', status: PLANNED,
    },
    {
      id: 'whatsapp_business', name: 'WhatsApp Business', icon: 'WA', category: 'Kommunikation',
      purpose: 'Synchronisiert den kundenzugeordneten Chat und versendet Nachrichten direkt aus der Kundenakte.',
      detail: whatsappConfigured ? 'Meta WhatsApp Cloud API ist für den CRM-Versand konfiguriert.' : 'Phone-Number-ID, Zugriffstoken und Webhook-Zugang müssen hinterlegt werden.',
      status: whatsappConfigured ? ACTIVE : READY,
    },
    {
      id: 'digital_contract', name: 'Digitaler Vertrag', icon: 'V', category: 'Vertragsabschluss',
      purpose: 'Übernimmt Vertragsdokument, Signatur und Videovertrag in den Verkaufsprozess.',
      detail: 'Anbieter und technische Anbindung werden noch festgelegt.', status: PLANNED,
    },
    {
      id: 'banking', name: 'Banking & Zahlungsabgleich', icon: '€', category: 'Finanzen',
      purpose: 'Gleicht Überweisungen und offene Vertragssalden später automatisch ab.',
      detail: 'Banking-Anbieter und Freigabeverfahren werden noch festgelegt.', status: PLANNED,
    },
  ];

  const agents = [
    {
      id: 'clara_dialog', name: 'Clara Dialogbegleitung', icon: 'C', phase: 'Wochen 1–8',
      situation: 'Führt den Teilnehmer durch Fragen, Rückfragen, Bestätigungen und offene Schritte.',
      tool: `OpenAI · ${openaiModel}`, detail: aiDetail, status: aiState,
    },
    {
      id: 'situation_recognition', name: 'Situations- & Mustererkennung', icon: 'S', phase: 'Laufend',
      situation: 'Erkennt Intentionen, wiederkehrende Themen, Spannungen, offene Fragen und relevante Fakten.',
      tool: 'Clara Evidenz- und Memory-Schema', detail: openaiConfigured ? 'Extraktion und Memory-Aktualisierung sind aktiv.' : aiDetail, status: aiState,
    },
    {
      id: 'career_recognition', name: 'Lebenslauf- & Stationenerkennung', icon: 'L', phase: 'Woche 1–2',
      situation: 'Strukturiert hochgeladene Lebensläufe in berufliche und ausbildungsbezogene Stationen.',
      tool: `OpenAI · ${openaiModel}`, detail: openaiConfigured ? 'Dokumentextraktion und strukturierte Ausgabe sind aktiv.' : aiDetail, status: aiState,
    },
    {
      id: 'implementation_dossier', name: 'Umsetzungs- & Dossieragent', icon: 'U', phase: 'Woche 8',
      situation: 'Soll Ergebnisse verdichten und den 24/30/90-Tage-Plan sowie das Abschlussdossier vorbereiten.',
      tool: 'Geplanter Spezialagent', detail: 'Ausgabeformat und Freigabelogik werden separat umgesetzt.', status: PLANNED,
    },
  ];

  return {
    checkedAt,
    integrations,
    agents,
    summary: {
      activeIntegrations: integrations.filter((item) => item.status.key === 'active').length,
      totalIntegrations: integrations.length,
      activeAgents: agents.filter((item) => item.status.key === 'active').length,
      totalAgents: agents.length,
      planned: [...integrations, ...agents].filter((item) => item.status.key === 'planned').length,
    },
  };
}
