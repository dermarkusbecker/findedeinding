# 4+4-Curriculum

Quelle: `FDD_8-Wochen-Curriculum_FINAL_optimiert.docx`, bereitgestellt am 15.09.2026. Die acht Wochen mit 39 Lektionen stehen in `curriculum/fdd-4plus4.json`. Lernziel, Einstieg, Kernfragen, adaptive Logik, Speicherlogik und Mini-Auswertung sind je Lektion übernommen.

## Ablauf und vorhandene Daten

- Wochen 1–4: Finde dein Ding. Wochen 5–8: Komm in die Umsetzung.
- Datenschutz und persönliches Commitment bleiben im bestehenden Onboarding. Das Commitment erfasst bereits Motivation, gewünschte Veränderung und die Folgen weiterer Unklarheit; diese Angaben stehen Clara als Kontext zur Verfügung.
- Die vorhandene Start-Klarheit wird vor der ersten neuen Lektion verlangt. Die bestehende Skala **1–10** bleibt ausdrücklich erhalten, obwohl die Vorlage 0–10 nennt. Auch Wochen- und Login-Check-ins sowie die Klarheitsanalyse behalten ihre bisherige Berechnung und Speicherung.
- Ein Lebenslauf bleibt optional. Er kann in Woche 1 ergänzt werden und dient der Entscheidungs-Timeline als Hintergrund.
- Jede Lektion speichert Gespräch, Originalquellen, Auswertung und Teilnehmerstatus. Erst ein ausdrücklicher Wochenabschluss sperrt die Woche.
- Werden frühere Antworten derselben offenen Woche geändert, bleiben spätere Texte erhalten, müssen aber vor Abschluss erneut geprüft werden.
- Das Ergebnis jeder Woche erscheint unter Erkenntnisse und im CRM. Es lässt sich öffnen, mit ESC oder einem Klick auf den Hintergrund schließen und über den Druckdialog als PDF exportieren.

Die ausdrücklich bestätigte Umstellung gilt auch für laufende Kunden. Alte `process_entries`, Dokumente, Klarheitsmessungen und veröffentlichte Prozessversionen werden nicht gelöscht. Frühere Zuordnungen stehen in `curriculum_assignment_archive`, der vorherige Entwurf in den benannten Entwürfen. Die neue Arbeit beginnt mit der ersten noch nicht erledigten **neuen** Lektion; alte Wochenabschlüsse werden nicht übernommen. Der bisherige zeitliche Freischaltungsplan bleibt bestehen.

## Baukasten

Der neue Entwurf enthält alle bisherigen Module, zusätzlich werden auch individuell gespeicherte alte Entwürfe und Veröffentlichungen in die Modulbibliothek übernommen. Über die Suche lassen sich beispielsweise Motivatoren wieder einsetzen. Die ursprüngliche Auswahlanzahl und Rangfolge bleiben erhalten. Externe Ergebnisse benötigen weiterhin eine dokumentierte Admin-Bestätigung; Dateien werden auf Kundenzuordnung geprüft.

Neue Vorlagen: beleggestützter Dialog, Vergleichsmatrix, Entscheidungs-Timeline, Recherche mit Quellen, Hypothesenprüfung, Proof Sprint, Aktionsplan und bestätigte Synthese. Die Erhebung erfolgt dialogisch mit Clara; die Ergebnisse werden entsprechend der editierbaren Speicherlogik strukturiert. Für Proof Sprints stehen Gespräch, Hospitation, Arbeitsprobe, Angebotstest und Mini-Projekt als mögliche Testformen bereit.

Alle Texte und Lektionsregeln sind im Baukasten editierbar. Aufgaben können auch aus Woche 1 verschoben werden. Entfernte Aufgaben wandern in die Bibliothek. Veröffentlichte Definitionen bleiben versioniert; die einmalige Umstellung bestehender Kunden erfolgt durch die Migration, spätere Veröffentlichungen überschreiben deren Antworten nicht.

## Prüfung und Veröffentlichung

- Node-Tests: `node --test tests/*.test.js`.
- Zusätzliche PostgreSQL-Prüfung mit PGlite: Migration, Zuordnungsarchiv, Pflichtlektionen, konkurrierende Revisionen, Folgeauswertungen und Abschluss-Sperre.
- Browserprüfung mit simulierten APIs: bestehendes Portal, Wochenstart, Desktop/Mobil, Gespräch, Ergebnisfenster, ESC, Modulbibliothek und Motivatoren-Rangfolge.
- Ein echter KI-Schnittstellentest verwendet ausschließlich erfundene Wünsche.

Für den Rollout zuerst den kompatiblen Anwendungscode bereitstellen, danach `20260916100000_curriculum_4plus4.sql` anwenden. Die Migration aktiviert das Curriculum für bestehende Kunden und den Standardtarif `fdd-8-wochen`. Vorherige Tarifzuordnungen bleiben in `curriculum_tariff_archive` erhalten.

Eine Rückkehr zur vorherigen Version kann über die archivierten Zuordnungen erfolgen, ohne die neu erfassten Antworten zu löschen. Sie muss gezielt je Kunde erfolgen; die Archive sind keine Aufforderung zu einem automatischen Rücksetzen.
