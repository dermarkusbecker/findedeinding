# Wochenstart: Veröffentlichung der Klarheitskorrektur

Die lokale Vorschau (`scripts/local-preview.mjs`) verwendet das veröffentlichte Backend. Reine Änderungen an `portal.js` aktivieren die neue Datenbankfunktion nicht.

## Reihenfolge

1. Auf derselben Supabase-Datenbank wie das Backend zuerst `supabase/migrations/20260911190000_demo_full_access_week_writes.sql`, danach `supabase/migrations/20260911200000_atomic_weekly_clarity.sql` ausführen. Die erste Migration berücksichtigt den vorhandenen Demo-Vollzugriff in der Datenbank-Freigabe. Die zweite ergänzt die transaktionale Speicherfunktion mit Zugriff ausschließlich für `service_role`.
2. Die Änderungen an `api/participant-program.js`, `api/leads.js`, `lib/weekly-clarity.js`, `portal.js`, `portal.html` und `portal-journey.css` gemeinsam veröffentlichen. Andere parallel bearbeitete Website-Dateien gehören nicht zu dieser Korrektur.
3. Mit einem vorgesehenen Testkunden Woche 2 öffnen, einen Wert speichern und anschließend die Kundenübersicht neu laden: Wochenstatus, aktueller Score und Diagramm müssen denselben gespeicherten Stand zeigen.
4. Bei einem niedrigeren Folgewert Begründung eingeben und den Nachgesprächseintrag im Admin-Bereich prüfen. Bei Kunden mit verknüpfter Interessentenakte entsteht eine fällige Aufgabe; direkt angelegte Kunden erscheinen in der bestehenden Kundenanfragen-Warteschlange als „Klarheits-Nachgespräch“. Beides wird innerhalb derselben Transaktion wie der Score gespeichert.

## Nachgewiesen

Alle 320 Node-Tests bestehen. Zusätzlich wurde die SQL-Funktion mit isoliertem PostgreSQL/PGlite geprüft: Speicherung, unveränderlicher Wochenwert, Wiederholungen ohne Duplikate, Pflichtbegründung bei Rückgang, Aufgabenanlage, Rücknahme der gesamten Transaktion bei Aufgabenfehler und reguläre/Demo-Wochenfreigabe. Keine echten Kundendaten wurden verändert.

Der Integrationstest liegt in `tests/weekly-clarity.integration.mjs`. Er kann mit `PGLITE_MODULE` als Pfad zu einer separat installierten `@electric-sql/pglite/dist/index.js` gestartet werden.

Die Veröffentlichung erfolgt über die vorhandenen Supabase- und Vercel-CLI-Anmeldungen. Die lokale Umgebungsdatei wird dafür nicht benötigt. Eine vollständige Browserprüfung mit einem Testkunden bleibt ein separater Abschlusscheck.
