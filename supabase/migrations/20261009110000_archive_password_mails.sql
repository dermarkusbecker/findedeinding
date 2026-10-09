-- Once the new code is live, retire the old two-message access templates.
update public.communication_templates
set status = 'archived',
    description = 'Archivierte Vorlage des früheren Zwei-Mail-Ablaufs; wird nicht mehr versendet.',
    updated_at = now()
where template_key in ('participant_access', 'participant_initial_password');
