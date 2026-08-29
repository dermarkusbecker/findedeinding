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
  [7, 'decision_or_escalation', 'Entscheidung oder Coach-Eskalation'],
  [8, 'implementation_plan', '24/30/90-Tage-Plan'],
  [8, 'final_commitment', 'Umsetzungs-Commitment'],
  [8, 'dossier_and_call', 'Dossier und Abschlusscall'],
];

export function participantGateRows(userProfileId) {
  return gateTemplates.map(([week, gate_key, label]) => ({
    user_profile_id: userProfileId,
    week,
    gate_key,
    label,
    required: true,
  }));
}
