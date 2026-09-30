alter table public.lead_communications
  add column if not exists sender_email text,
  add column if not exists cc_emails text[],
  add column if not exists bcc_emails text[];

comment on column public.lead_communications.sender_email is 'Tatsächlich verwendete Absenderadresse der versendeten E-Mail.';
comment on column public.lead_communications.cc_emails is 'Tatsächliche CC-Empfänger. NULL bei Alteinträgen ohne protokollierten Mailumschlag.';
comment on column public.lead_communications.bcc_emails is 'Tatsächliche BCC-Empfänger. NULL bei Alteinträgen ohne protokollierten Mailumschlag.';
