-- Add the new template without changing the currently deployed mail flow.
insert into public.communication_templates
  (template_key, name, description, category, channel, subject, body, status)
values
  ('participant_setup_link', 'Kundenportal: Passwort selbst festlegen', 'Nach Vertragsabschluss oder erneutem Versand: Benutzername, E-Mail und sicherer Einrichtungslink in einer gestalteten Nachricht.', 'participant', 'email', 'Dein Zugang zum Finde dein Ding Kundenportal', E'Hallo {{vorname}},\n\ndein Kundenportal ist bereit. Richte jetzt dein persönliches Passwort über diesen sicheren Einmal-Link ein:\n\n{{setup_link}}\n\nDein Benutzername: {{login_name}}\nDu kannst dich später auch mit deiner E-Mail-Adresse anmelden: {{email}}\n\nNach dem Festlegen deines Passworts gelangst du direkt in dein Kundenportal. Falls du diese Nachricht nicht im Posteingang findest, prüfe bitte auch deinen Spam-Ordner. Wenn der Link abgelaufen ist, fordere im Login über „Passwort vergessen?“ einen neuen an.', 'active')
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  subject = excluded.subject,
  body = excluded.body,
  status = excluded.status,
  updated_at = now();
