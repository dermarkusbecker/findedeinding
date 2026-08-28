# findedeinding

Landingpage und CRM-Prototyp mit Vercel Functions und Supabase.

## Deployment

1. `supabase/schema.sql` im SQL Editor des Supabase-Projekts ausführen.
2. Das GitHub-Repository als Vercel-Projekt importieren.
3. In Vercel für Production, Preview und Development setzen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AUTH_SECRET` (mindestens 32 zufällige Zeichen)
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
4. Neu deployen und `/api/health` prüfen.

Der Service-Role-Key bleibt ausschließlich in Vercel. Er darf niemals in Browser-Code oder Git eingecheckt werden.

## Bereiche

- `/` – öffentliche Landingpage und Lead-Funnel
- `/login` – serverseitig geprüfter Login
- `/admin` – CRM-Dashboard und Benutzerverwaltung
- `/portal` – schematisches Kundenportal für den 8-Wochen-Prozess

Die gewünschten Zugangsdaten werden ausschließlich als geschützte Vercel-Variablen gesetzt und nicht im Git-Repository gespeichert.
