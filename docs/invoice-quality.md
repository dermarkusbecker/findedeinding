# Rechnungen und Steuerberater-Dashboard

Der neue A4-Briefbogen verwendet das Original-Logo, eingebettete Manrope-Schriften, einen Empfängerblock, Rechnungsmetadaten, eine Leistungstabelle, getrennte Nettobeträge/Umsatzsteuer/Bruttobeträge und einen Zahlungsblock. Der bestehende Datenbestand stellt eine Rechnung für eine vereinbarte Gesamtleistung dar; es werden keine erfundenen Einzelpositionen oder Preise ergänzt.

## Ausstellung und Archiv

- Rechnungsnummern kommen weiterhin aus der Datenbanksequenz. Ein unterschriebener Vertrag erzeugt höchstens eine Rechnung.
- Neue ausgestellte Rechnungen werden serverseitig auf Pflichtfelder, Leistungsdatum, Fälligkeit und konsistente Centbeträge geprüft. Unvollständige Vertragsrechnungen bleiben ohne Rechnungsnummer in `needs_details`.
- Rechnungssteller, Kontakt-/Bankdaten, Steuersatz und Vertrags-/Kundenbezug werden bei Ausstellung eingefroren. Änderungen an Einstellungen ändern keine ausgestellte Rechnung.
- `invoices/<id>.pdf` bleibt das archivierte Original; `invoices/<id>.design-v2.pdf` enthält die gestaltete Darstellung derselben unveränderten Daten. Beide werden ohne Überschreiben gespeichert. Bei konkurrierendem Upload wird das tatsächlich archivierte Dokument zurückgegeben.
- Rechnungskorrekturen referenzieren die ursprüngliche Rechnung, tragen ihre eigene Belegnummer und ihr eigenes Datum und geben keinen neuen Zahlungsauftrag aus.
- Bei 0 % ist eine fachlich zutreffende steuerliche Erläuterung erforderlich. Die Anwendung bestimmt nicht eigenständig, ob eine Steuerbefreiung vorliegt.
- Monat/Jahr im CRM und das Steuerberater-Dashboard basieren auf `financeReport`: ausgestellte Rechnungen minus Korrekturen nach Belegdatum; Zahlungseingänge separat nach Buchungsdatum. Keine Betriebsausgaben oder automatische USt-Voranmeldung.

## Rechtlicher Anwendungsbereich

Umgesetzt sind die Daten- und Darstellungsprüfungen für die vorhandenen einfachen Leistungsrechnungen nach § 14 Abs. 4 UStG. Die tatsächliche Richtigkeit der Anschrift, Steuernummer, Leistungsbeschreibung und steuerlichen Einordnung muss der Rechnungssteller sicherstellen. Reverse Charge, grenzüberschreitende Sachverhalte, Anzahlungs-/Schlussrechnungen mit steuerlicher Verrechnung und gemischte Steuersätze innerhalb einer Rechnung brauchen gesonderte Fachlogik.

Ein PDF ist keine strukturierte E-Rechnung nach EN 16931. Diese Änderung implementiert weder XRechnung noch ZUGFeRD und ersetzt keine vollständige GoBD-Verfahrensdokumentation, Datensicherung oder gesetzliche Aufbewahrungsorganisation. Bereits vorhandene administrative Löschfunktionen sind kein gesetzeskonformes Rechnungsarchiv mit Aufbewahrungssperre.

Quellen (geprüft September 2026):
- https://www.gesetze-im-internet.de/ustg_1980/__14.html
- https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html

## Prüfung

`node --test tests/*.test.js`

`PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/invoice-quality-postgres.mjs`

`PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node tests/customer-deletion-postgres.mjs`

Die Tests verwenden ausschließlich synthetische Datensätze. Der PDF-Test erzeugt `/tmp/fdd-rechnung-muster.pdf` als Layoutprobe mit Musterkundin und Musterbankverbindung.
