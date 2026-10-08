-- Two separate branded emails after a signed contract. The password template is
-- rendered in memory; the issued password is never stored in communication logs.
update public.communication_templates
set name = 'Kundenportal: Benutzername und Login-Link',
    description = 'Erste von zwei Zugangsmails nach Vertragsabschluss. Benutzername und direkter Portal-Link.',
    subject = 'Dein Zugang zum Finde dein Ding Kundenportal',
    body = E'Hallo {{vorname}},\n\ndein Vertrag ist abgeschlossen und dein Kundenportal ist bereit.\n\nDein Benutzername: {{login_name}}\n\nHier kannst du dich direkt anmelden: {{login_link}}\n\nDein Erstanmeldepasswort erhältst du aus Sicherheitsgründen in einer separaten E-Mail. Nach der ersten Anmeldung wirst du aufgefordert, ein neues persönliches Passwort festzulegen.',
    status = 'active',
    updated_at = now()
where template_key = 'participant_access';

insert into public.communication_templates
  (template_key, name, description, category, channel, subject, body, status)
values
  ('participant_initial_password', 'Kundenportal: Erstanmeldepasswort', 'Zweite Zugangsmail nach Vertragsabschluss. Enthält das einmalige Startpasswort; der gerenderte Inhalt wird nicht im CRM gespeichert.', 'participant', 'email', 'Dein Erstanmeldepasswort für Finde dein Ding', E'Hallo {{vorname}},\n\nhier ist dein Erstanmeldepasswort für das Finde dein Ding Kundenportal:\n\n{{passwort}}\n\nDeinen Benutzernamen und den direkten Anmeldelink findest du in der separaten E-Mail zum Kundenportal. Nach der ersten Anmeldung musst du dieses Passwort durch ein eigenes ersetzen.', 'active')
on conflict (template_key) do nothing;
