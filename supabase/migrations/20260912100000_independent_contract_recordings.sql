alter table public.lead_contracts
  add column if not exists video_recording_upload jsonb,
  add column if not exists video_recording_reviewed_at timestamptz;
comment on column public.lead_contracts.video_recording_upload is 'Noch nicht bestätigter Direktupload. Erst nach Prüfung der gespeicherten Datei wird der Aufzeichnungspfad freigegeben.';
comment on column public.lead_contracts.video_recording_provider is 'Aufnahmequelle: browser_screen, device_upload oder google_meet (Bestandsaufnahmen).';
comment on column public.lead_contracts.video_recording_path is 'Privater Pfad einer vollständig gespeicherten Vertragsaufzeichnung.';
