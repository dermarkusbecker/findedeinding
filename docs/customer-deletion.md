# Bestätigte Kundenlöschung

In der Kundenakte steht „Kunden löschen“ ausschließlich den Rollen `owner` und `administrator` zur Verfügung. `POST /api/users?action=delete-customer` prüft die aktuelle Rolle, den ausgewählten Kunden, das Pflicht-Häkchen und den zuvor angezeigten Namen. Der Client kann keinen abweichenden ausführenden Administrator angeben. Die Datenbank prüft die Rolle erneut; Mitarbeiterkonten, das eigene Konto und geteilte Lead-Zuordnungen werden nicht gelöscht.

`delete_customer_confirmed` entfernt die Kundendaten transaktional einschließlich Rechnungen, Zahlungen, Gutschriften, Ratenplänen und Mahnungen. Das Löschmanifest enthält zuvor ermittelte exakte Storage-Pfade. Finanzielle Unveränderlichkeit bleibt für normale Buchungsaktionen bestehen; die Ausnahme ist auf den konkreten bestätigten Löschauftrag und dessen eigene Lead-IDs beschränkt.

Anschließend entfernt der Server die Dateien über die Storage-API und das Auth-Konto über die Auth-Admin-API. Storage-Metadaten werden nicht direkt per SQL gelöscht. Ein Fehler meldet ausdrücklich `cleanupPending`, statt eine vollständige Löschung zu behaupten. Offene Bereinigungen erscheinen für Administratoren in der Kundenübersicht und können mit derselben Anfrage fortgesetzt werden. Nach Abschluss werden Name, Auth-ID, Lead-IDs und Dateimanifest aus dem Auftrag entfernt; technische Vorgangs-ID, Kunden-UUID, ausführender Admin und Zeitstempel bleiben als Nachweis.

Die App prüft bei geschützten Anfragen das aktuelle Profil. Nach dem transaktionalen Entfernen der Kundenakte wird damit auch ein bestehender Portalzugang abgewiesen. Bereits versendete Nachrichten, externe Kalendertermine und heruntergeladene Kopien werden nicht zurückgerufen. Keine Live-Kundenlöschung während Implementierung oder Veröffentlichung.

Prüfungen: `node --test tests/customer-deletion.test.js`; lokaler SQL-Test `PGLITE_MODULE=<module path> node tests/customer-deletion-postgres.mjs`; Browserprüfung mit synthetischen Kundendaten für Rollensichtbarkeit, Pflichtbestätigung, Abbrechen, Mobilansicht und Wiederholung einer unterbrochenen Bereinigung.
