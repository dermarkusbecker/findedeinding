# Rechnungen, Ratenpläne und Mahnungen

Kundenakte → Finanzen & Verträge → Rechnungen & Ratenpläne. Neue Rechnungen verwenden die vorhandene Kontobuchung. Ratenpläne teilen den bestehenden offenen Rechnungsbetrag auf und erzeugen keine zweite Forderung. Beträge werden centgenau verteilt; monatliche Termine behalten den ursprünglichen Tag (mit Monatsendkorrektur).

Eine aktive oder pausierte Vereinbarung pro Kunde. Optional wird nur eine Rechnung geplant. Unzugeordnete Zahlungen und Guthaben sind vorher im Konto zu klären. Eine Änderung ersetzt die Vereinbarung für den aktuellen Restbetrag; Vorgänger, Raten und Anfragen bleiben erhalten. Aufheben reaktiviert die ursprünglichen Rechnungsfälligkeiten. Der Kundenportalzugang zeigt nur eigene aktive/pausierte Pläne.

Zahlungen und Entlastungen reduzieren die ältesten Raten der jeweiligen Rechnung zuerst. „Bezahlt“ im Erstellungsdialog erzeugt tatsächlich gebuchte, zugeordnete Zahlungen; bereits vorhandene Zahlungen dürfen nicht erneut erfasst werden. Änderungen am Rechnungs-Fälligkeitsdatum sind bei einer laufenden Vereinbarung gesperrt; Fälligkeiten werden im Ratenplan geändert.

## Mahnlauf

Vercel ruft täglich um 07:00 UTC `/api/leads?action=dunning-cron` auf. Erforderlich sind `CRON_SECRET`, `STRATO_MAILBOX_USER`, `STRATO_MAILBOX_PASSWORD` und die vorhandenen Supabase-Servervariablen. Autorisierung ausschließlich über `Authorization: Bearer …`; keine Browser- oder Kundenberechtigung reicht aus. `&check=1` prüft nur SMTP-Anmeldung und Aktivierung, ohne Versand.

Einstellungen → Mahnstufen: Aktivierung, drei Zeitabstände, Betreff und Nachricht, Vorschau mit Logo/Signatur. Vorgabe: 14 Kalendertage ab Fälligkeit, dann jeweils 14 Tage ab tatsächlich versendeter vorheriger Stufe. Keine Gebühren oder Zinsen. Aktive Raten ersetzen die Rechnungsfälligkeit im Mahnlauf; pausierte Pläne werden nicht angemahnt. Beträge und Zuordnung werden unter Datenbanksperren vor Reservierung und nochmals vor Versand geprüft. Ungeklärte Zahlungseingänge/Guthaben sperren Mahnungen des Kunden.

Jeder Versuch wird vor Versand im Kundenverlauf gespeichert. SMTP-Annahme bedeutet nicht nachgewiesene Zustellung. Ein einmaliger DB-Übergang schützt vor parallelem Doppelversand. Unklare SMTP-Ergebnisse oder fehlende Abschlussprotokolle werden nicht automatisch wiederholt. Einstellungen → Versandprotokoll → Versand prüfen erlaubt nach tatsächlicher Prüfung die Bestätigung oder erneute Freigabe. Laufende/vorbereitete Versuche sind 15 Minuten gegen diese Überprüfung gesperrt. Ein neuer Versuch wird beim nächsten täglichen Lauf erneut auf offene Beträge geprüft. Pro Aufruf wird vor Ablauf des Serverlimits beendet; verbleibende Fälle werden im nächsten Lauf bearbeitet.

## Prüfungen

`node --test tests/*.test.js` und `PGLITE_MODULE=<absolute pglite module> node tests/installments-postgres.mjs`. SQL-Prüfung verwendet ausschließlich lokale synthetische Daten: Centbeträge, transaktionale Validierung, kein Doppelumsatz, Kundenzuordnung, Wiederholungen, Zahlungen/Gutschriften, Ersetzen/Pause/Aufheben, zeitlicher Mahnabstand, Einzelversand und erneute Freigabe. Manuelle Browserprüfung: Desktop/Mobil, Dialog-Scrollbereich, Summe und Kalendertermine, Zahlungsauswahl, Speichern und Einstellungsansicht.
