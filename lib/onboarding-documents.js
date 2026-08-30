export function buildPrivacyConsentText({ name = 'Teilnehmer' } = {}) {
  return {
    title: 'Datenschutzeinwilligung',
    content: `
    ${name}, du bist damit einverstanden, dass deine Angaben, Antworten, Uploads und Prozessdaten im Rahmen des Finde-dein-Ding-Programms verarbeitet werden, um deinen Ablauf zu begleiten, deine Entwicklung zu dokumentieren und dir gezielte Rückfragen und Unterstützung zu geben.

    Zweck der Verarbeitung:
    - Begleitung deines achtwöchigen Prozesses
    - Dokumentation deiner Antworten, Erkenntnisse und Uploads
    - Persönliche Rückmeldung, Reflexion und Prozesssteuerung

    Verarbeitung:
    - Daten werden nur für den konkret vereinbarten Coaching-Prozess genutzt
    - Inhalte werden nach dem Prinzip der Zweckbindung verarbeitet
    - sensible persönliche Angaben werden getrennt von strukturierten Dokumenten behandelt

    Speicherung:
    - Die Daten werden sicher in der von uns genutzten Plattform gespeichert
    - Nur der relevante Prozessverlauf und die notwendigen Dokumente sind zugänglich

    Widerruf:
    - Du kannst deine Einwilligung jederzeit widerrufen
    - Ein Widerruf kann die bisherige, rechtmäßig erfolgte Verarbeitung nicht rückwirkend unrechtmäßig machen

    Durch deine Bestätigung erklärst du dich mit den oben genannten Zwecken einverstanden.
    `,
  };
}

export function buildStartCommitmentDocument({ name = 'Teilnehmer' } = {}) {
  return {
    title: 'Mein Start-Commitment',
    content: `
    ${name}

    Ich nehme den achtwöchigen Prozess ernsthaft in Angriff.
    Ich bin bereit, meine Antworten ehrlich zu formulieren, meine Widerstände sichtbar zu machen und mich nicht vorschnell aus dem Prozess zu verabschieden.

    Ich möchte meine Entscheidung nicht nur denken, sondern auch konkret erleben, prüfen und mit Verantwortung weiterentwickeln.

    Ich bestätige hiermit bewusst mein persönliches Commitment für den Start dieses Prozesses.

    Ort, Datum: ______________________
    Name: ${name}
    Unterschrift: ______________________
    `,
  };
}
