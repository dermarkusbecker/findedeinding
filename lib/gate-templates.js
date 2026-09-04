export const gateTemplates = [
  [0, 'privacy_consent', 'Datenschutz aktiv bestätigt'],
  [0, 'start_commitment', 'Start-Commitment unterschrieben'],
  [1, 'three_wishes', 'Drei Wünsche vertieft'],
  [1, 'target_and_baseline', 'Zielzustand und Klarheits-Baseline'],
  [1, 'career_history', 'Werdegang vollständig'],
  [2, 'skills', 'Formales und informelles Können'],
  [2, 'self_external_view', 'Selbst- und Fremdbild'],
  [2, 'current_goal', 'Aktuelles Ziel'],
  [3, 'motivators', 'Top 5 Motivatoren'],
  [3, 'childhood', 'Kindheitsinteressen'],
  [3, 'reintegration', 'Reintegration gewählt'],
  [4, 'human_design', 'Human Design technisch verarbeitet'],
  [4, 'puzzle_assignment', 'Ding/Leben-Zuordnung'],
  [4, 'midpoint_report', 'Halbzeitbericht erzeugt'],
  [5, 'values', 'Top 5 Werte'],
  [5, 'lila', 'LILA abgeschlossen'],
  [5, 'eulogy', 'Grabrede hochgeladen'],
  [6, 'four_areas', 'Vier FDD-Bereiche'],
  [6, 'exclusion_criteria', 'Mindestens 10 Ausschlusskriterien'],
  [6, 'ding_map', 'Positivkriterien und Dein-Ding-Map'],
  [7, 'reality_contact', 'Mindestens ein Realitätskontakt'],
  [7, 'final_two', 'Genau zwei Optionen'],
  [7, 'decision_confirmation', 'Entscheidung persönlich bestätigen'],
  [8, 'implementation_plan', '24/30/90-Tage-Plan'],
  [8, 'final_commitment', 'Umsetzungs-Commitment'],
  [8, 'dossier_and_call', 'Dossier und Abschlusscall'],
];

export const gateWeekDefaults = Object.freeze([
  { week: 0, title: 'Onboarding', description: 'Datenschutz und Start-Commitment schaffen die verbindliche Grundlage für den Programmstart.' },
  { week: 1, title: 'Ausgangslage', description: 'Wünsche, Zielbild, Klarheits-Baseline und bisheriger Werdegang sind vollständig erfasst.' },
  { week: 2, title: 'Fähigkeiten & Umfeld', description: 'Formales und informelles Können sowie Selbstbild, Fremdbild und aktuelles Ziel sind dokumentiert.' },
  { week: 3, title: 'Motivatoren', description: 'Die wichtigsten Motivatoren und frühen Interessen sind priorisiert und in die Gegenwart übersetzt.' },
  { week: 4, title: 'Halbzeit', description: 'Human Design, Ding-Leben-Zuordnung und Halbzeitbericht sind technisch und fachlich abgeschlossen.' },
  { week: 5, title: 'Werte & Lebenswerk', description: 'Werte, LILA und die persönliche Grabrede verdichten das langfristig Bedeutsame.' },
  { week: 6, title: 'Dein-Ding-Map', description: 'Die vier Bereiche sowie Ausschluss- und Positivkriterien sind in der Dein-Ding-Map verbunden.' },
  { week: 7, title: 'Optionen & Realität', description: 'Realitätskontakt und zwei finale Optionen führen zu einer persönlich bestätigten Entscheidung.' },
  { week: 8, title: 'Umsetzung', description: 'Entscheidung, Umsetzungsplan, Commitment, Dossier und Abschlusscall sind vollständig vorbereitet.' },
]);

export function gateWeekSettingRows() {
  return gateWeekDefaults.map((item) => ({
    week: item.week,
    title: item.title,
    description: item.description,
    default_title: item.title,
    default_description: item.description,
  }));
}

export function gateTemplateSettingRows() {
  const positions = new Map();
  return gateTemplates.map(([week, gateKey, label]) => {
    const sortOrder = (positions.get(week) || 0) + 1;
    positions.set(week, sortOrder);
    return { gate_key: gateKey, week, label, default_label: label, sort_order: sortOrder };
  });
}

export function participantGateRows(userProfileId) {
  return gateTemplates.map(([week, gate_key, label]) => ({
    user_profile_id: userProfileId,
    week,
    gate_key,
    label,
    required: true,
  }));
}
