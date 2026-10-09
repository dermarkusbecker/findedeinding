const status = (key, label, tone) => ({ key, label, tone });

const ACTIVE = status('active', 'Aktiv', 'positive');
const READY = status('ready', 'Bereit zur Verbindung', 'warning');
const MISSING = status('missing', 'Konfiguration fehlt', 'danger');
const PLANNED = status('planned', 'Geplant', 'neutral');

export function buildSystemRegistry({ mailConfigured = false, mailUser = '', googleConfigured = false, googleConnection = null, googleMeetRecordingReady = false, openaiConfigured = false, openaiModel = 'gpt-5.6-terra', whatsappConfigured = false, stripeConfigured = false, stripeWebhookConfigured = false, vercelConfigured = false, checkedAt = new Date().toISOString() } = {}) {
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
      id: 'vercel', name: 'Vercel', icon: 'V', category: 'Hosting & API',
      purpose: 'Stellt Website, Kundenportal, CRM und serverseitige API bereit.',
      detail: vercelConfigured ? 'Diese Systemprüfung läuft auf Vercel.' : 'Laufzeitumgebung ist lokal oder über einen anderen Host gestartet.',
      status: vercelConfigured ? ACTIVE : READY,
    },
    {
      id: 'openai', name: 'OpenAI', icon: 'AI', category: 'KI-Plattform',
      purpose: 'Versorgt Clara, Situationsanalyse, Wochenreflexionen, Zwischen- und Abschlussberichte sowie Dokumentstrukturierung mit KI-Funktionen.',
      detail: aiDetail, status: aiState,
    },
    {
      id: 'google_calendar', name: 'Google Kalender', icon: '31', category: 'Terminplanung',
      purpose: 'Prüft Verfügbarkeiten und synchronisiert Kundengespräche mit dem CRM.',
      detail: googleDetail, status: googleState, action: 'google-connect',
    },
    {
      id: 'google_meet', name: 'Google Meet', icon: 'M', category: 'Videogespräche',
      purpose: 'Erstellt optionale Meet-Links; Vertragsaufnahmen sind auch ohne Meet möglich.',
      detail: googleMeetRecordingReady ? 'Meet- und Drive-Zugriff für die automatische Aufzeichnungsübernahme sind freigegeben.' : googleConnection ? 'Google ist verbunden, muss für Meet-Aufzeichnungen aber einmal neu autorisiert werden.' : googleDetail,
      status: googleMeetRecordingReady ? ACTIVE : googleConfigured ? READY : MISSING, action: 'google-connect',
    },
    {
      id: 'google_drive', name: 'Google Drive', icon: 'D', category: 'Aufzeichnungen',
      purpose: 'Liest freigegebene Meet-Aufzeichnungen für die Zuordnung in der Kundenakte.',
      detail: googleMeetRecordingReady ? 'Leseberechtigung für Meet-Aufzeichnungen ist freigegeben.' : 'Die erforderliche Google-Berechtigung muss verbunden werden.',
      status: googleMeetRecordingReady ? ACTIVE : googleConfigured ? READY : MISSING, action: 'google-connect',
    },
    {
      id: 'supabase_auth_mail', name: 'Sichere Passwort-Links', icon: '@', category: 'Systemkommunikation',
      purpose: 'Erzeugt sichere Links zur ersten und erneuten Passwortvergabe.',
      detail: 'Supabase Auth erzeugt nur den Link. Die gestaltete E-Mail mit Signatur wird über STRATO versendet.', status: ACTIVE,
    },
    {
      id: 'domain_email', name: 'STRATO-Postfach', icon: '@', category: 'Kommunikation',
      purpose: 'Versendet gestaltete CRM-Mails über SMTP und übernimmt zugeordnete Eingangsmails über IMAP.',
      detail: mailConfigured ? `${mailUser} · Zugangsdaten hinterlegt. Die Anmeldung wird geprüft.` : 'Postfachadresse und Passwort müssen als STRATO_MAILBOX_USER und STRATO_MAILBOX_PASSWORD in Vercel hinterlegt werden.',
      status: mailConfigured ? status('ready', 'Zugang prüfen', 'warning') : MISSING,
      action: 'strato-mail-check',
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
      detail: 'PDF-Vertrag, unabhängige Bildschirmaufnahme und privater Video-Upload sind im CRM integriert.', status: ACTIVE,
    },
    {
      id: 'stripe', name: 'Stripe', icon: '€', category: 'Finanzen',
      purpose: 'Erstellt sichere Zahlungsseiten für offene Kundenkonten und bucht bestätigte Zahlungen automatisch.',
      detail: stripeConfigured && stripeWebhookConfigured ? 'API-Schlüssel und Webhook-Signatur sind hinterlegt. Die Verbindung wird geprüft.' : 'Für Live-Zahlungen fehlen noch STRIPE_SECRET_KEY oder STRIPE_WEBHOOK_SECRET in Vercel.',
      status: stripeConfigured && stripeWebhookConfigured ? READY : MISSING,
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
      id: 'week_reflection', name: 'Clara Wochenreflexion', icon: 'R', phase: 'Nach jedem Wochenschluss',
      situation: 'Verdichtet ausschließlich die final gespeicherten Aussagen der beendeten Woche zu einem persönlichen Rückblick und ergänzt fehlende Reflexionen früherer Abschlüsse automatisch.',
      tool: `OpenAI Responses · ${openaiModel}`, detail: openaiConfigured ? 'Abschluss-Trigger, automatische Nachverarbeitung und beleggebundene Ersatzlogik sind aktiv.' : `${aiDetail} Die sichere beleggebundene Ersatzlogik bleibt verfügbar.`, status: aiState,
    },
    {
      id: 'milestone_reports', name: 'Zwischen- & Abschlussberichte', icon: 'B', phase: 'Nach Woche 4 und 8',
      situation: 'Erstellt aus abgeschlossenen Teilnehmerangaben einen gespeicherten Zwischenbericht und einen Abschlussbericht mit ehrlicher Einordnung der Umsetzung.',
      tool: `OpenAI Responses · ${openaiModel}`, detail: openaiConfigured ? 'Die bestehende OpenAI-Schnittstelle ist aktiv. Ein separater Spezialagent kann später angebunden werden.' : `${aiDetail} Eine beleggebundene Ersatzfassung bleibt verfügbar.`, status: aiState,
    },
    {
      id: 'customer_clarity', name: 'Klarheitsanalyse & Gesprächsvorbereitung', icon: 'K', phase: 'Kundenakte · laufend',
      situation: 'Systematisiert freigegebene Ergebnisse aus dem Acht-Wochen-Prozess und erstellt beleggebundene Gesprächsansätze für Google Meet, Telefon und WhatsApp.',
      tool: `OpenAI Responses · ${openaiModel}`, detail: openaiConfigured ? 'Die Analyse wird bei neuen Prozessdaten automatisch aktualisiert und bleibt bis dahin stabil zwischengespeichert.' : `${aiDetail} Die beleggebundene Ersatzanalyse bleibt verfügbar.`, status: aiState,
    },
    {
      id: 'implementation_dossier', name: 'Separater Dossier-Spezialagent', icon: 'U', phase: 'Spätere Anbindung',
      situation: 'Kann später den bestehenden Abschlussbericht über eine eigene API-Schnittstelle ergänzen.',
      tool: 'Geplanter Spezialagent', detail: 'Noch nicht verbunden. Der aktuelle Bericht läuft über die bestehende OpenAI-Schnittstelle.', status: PLANNED,
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
