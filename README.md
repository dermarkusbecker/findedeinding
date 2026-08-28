# findedeinding

Landingpage und CRM-Prototyp mit Vercel Functions und Supabase.

## Deployment

1. `supabase/schema.sql` im SQL Editor des Supabase-Projekts ausführen.
2. Das GitHub-Repository als Vercel-Projekt importieren.
3. In Vercel für Production, Preview und Development setzen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Neu deployen und `/api/health` prüfen.

Der Service-Role-Key bleibt ausschließlich in Vercel. Er darf niemals in Browser-Code oder Git eingecheckt werden.
