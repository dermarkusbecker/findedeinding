# findedeinding

Landingpage und CRM-Prototyp mit Vercel Functions und Supabase.

## Lokal ansehen

```bash
npm run dev
```

Danach ist die Website unter `http://localhost:3000` erreichbar. Statische Dateien
werden direkt aus dem lokalen Arbeitsordner geladen. API-Aufrufe, Login, Admin und
Portal werden an das verbundene Production-Backend weitergeleitet, weil Vercel
Variablen vom Typ `Secret` absichtlich nicht lokal exportiert. Dadurch bleiben der
Supabase-Service-Key und andere Zugangsdaten geschützt.

Wichtig: Datenänderungen in dieser Vorschau wirken auf die Production-Datenbank.
Mit `LOCAL_API_ORIGIN` kann bei Bedarf ein anderes Backend gesetzt werden.

## Deployment

1. `supabase/schema.sql` im SQL Editor des Supabase-Projekts ausführen.
2. Das GitHub-Repository als Vercel-Projekt importieren.
3. In Vercel für Production, Preview und Development setzen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AUTH_SECRET` (mindestens 32 zufällige Zeichen)
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `CUSTOMER_USERNAME`
   - `CUSTOMER_PASSWORD`
4. Neu deployen und `/api/health` prüfen.

## Clara-KI aktivieren

1. Nach dem Basisschema `supabase/clara-ai-migration.sql` im Supabase SQL Editor ausführen.
2. In Vercel zusätzlich setzen:
   - `OPENAI_API_KEY`
   - `CLARA_OPENAI_MODEL=gpt-5.6-terra`
   - `CLARA_REASONING_EFFORT=low`
   - `CLARA_MAX_OUTPUT_TOKENS=1800`
3. Neu deployen. Der Key wird nur in den serverseitigen Functions verwendet.

Clara speichert Originalaussagen append-only in `process_entries`, den Dialog in `clara_messages`, abgeleitete und versionierte Erkenntnisse in `participant_memory` und Uploads getrennt in `participant_documents` sowie im privaten Storage-Bucket `participant-documents`. Modellvorschläge laufen immer durch den Week-1-Reducer; Clara darf keine Gates oder Wochen direkt freischalten.

Der Service-Role-Key bleibt ausschließlich in Vercel. Er darf niemals in Browser-Code oder Git eingecheckt werden.

## Bereiche

- `/` – öffentliche Landingpage und Lead-Funnel
- `/login` – serverseitig geprüfter Login
- `/kunden-login` – separater Kunden-Login
- `/admin` – CRM-Dashboard und Benutzerverwaltung
- `/portal` – interaktiver Kundenprozess mit Onboarding, Wochen-Gates und Fortschritt

Die gewünschten Zugangsdaten werden ausschließlich als geschützte Vercel-Variablen gesetzt und nicht im Git-Repository gespeichert.
