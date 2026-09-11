const messages = [
  ['Dein erster Schritt zählt.', 'Du hast dir Zeit für eine ehrliche Standortbestimmung genommen. Darauf bauen wir auf.'],
  ['Da bewegt sich etwas!', 'Du erkennst mehr von dem, was in dir steckt. Nimm diesen Fortschritt bewusst wahr.'],
  ['Dein innerer Kompass wird klarer.', 'Du schaust genauer hin, was dich antreibt. Stark, dass du dranbleibst!'],
  ['Die Puzzleteile finden zusammen.', 'Du hast dir neue Zusammenhänge erarbeitet. Das darf sich gut anfühlen.'],
  ['Mehr Klarheit. Mehr du.', 'Du gibst dem Raum, was dir wichtig ist. Ein schöner Schritt auf deinem Weg.'],
  ['Aus Gedanken wird Richtung.', 'Deine Arbeit bekommt Konturen. Halte kurz inne und würdige, was du erkannt hast.'],
  ['Du machst deinen Weg greifbar.', 'Du prüfst deine Möglichkeiten und lernst daraus. Genau dieses Dranbleiben zählt.'],
  ['Nimm deine Klarheit mit ins Leben.', 'Du hast dir Orientierung erarbeitet. Jetzt kannst du sie in konkrete Schritte übersetzen.'],
];

export function clarityFeedback(week, previousScore, score) {
  const delta = previousScore === null ? null : score - previousScore;
  if (delta === null) return { kind: 'baseline', title: messages[0][0], text: messages[0][1], delta };
  if (delta === 0) return { kind: 'steady', title: 'Okay, dann arbeiten wir weiter.', text: 'Dein Wert bleibt heute gleich. Wir machen in deinem Tempo weiter.', delta };
  if (delta < 0) return { kind: 'decline', title: 'Danke für deine ehrliche Einschätzung.', text: 'Deine Begründung ist gespeichert. Markus bekommt eine Aufgabe, um mit dir genauer hinzuschauen.', delta };
  const [title, text] = messages[week - 1] || messages[1];
  return { kind: 'improvement', title, text, delta };
}

export function assertClarityPersisted(program, week, score) {
  const saved = program?.clarityHistory?.find((item) => Number(item.week) === week);
  const checkin = week === 1 ? program?.weekOne?.clarity_baseline : program?.weekState?.clarity_checkin;
  if (Number(program?.selectedWeek) !== week || !checkin?.completed || Number(checkin.score) !== score || !saved || Number(saved.score) !== score) {
    throw new Error('Der gespeicherte Wert wurde noch nicht bestätigt. Bitte versuche es erneut; deine Woche wird erst nach der Bestätigung geöffnet.');
  }
}

export async function persistWeeklyClarity(service, participantId, week, score, note, initialState) {
  const response = await fetch(`${service.url}/rest/v1/rpc/save_weekly_clarity`, {
    method: 'POST',
    headers: { apikey: service.key, Authorization: `Bearer ${service.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_participant_id: participantId, p_week: week, p_score: Number(score), p_note: String(note || '').trim().slice(0, 3000), p_initial_state: initialState }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.state) {
    const missingMigration = result?.code === 'PGRST202';
    throw Object.assign(new Error(missingMigration ? 'Die Speicherfunktion für den Wochenstart ist noch nicht eingerichtet. Bitte Markus kontaktieren.' : result?.message || 'Dein Klarheitswert konnte nicht verbindlich gespeichert werden.'), { status: response.status >= 400 ? response.status : 502 });
  }
  return result;
}
