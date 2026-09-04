begin;

update public.gate_week_settings
set description = 'Realitätskontakt und zwei finale Optionen führen zu einer persönlich bestätigten Entscheidung.',
    default_description = 'Realitätskontakt und zwei finale Optionen führen zu einer persönlich bestätigten Entscheidung.',
    updated_at = now()
where week = 7;

update public.gate_template_settings
set gate_key = 'decision_confirmation',
    label = 'Entscheidung persönlich bestätigen',
    default_label = 'Entscheidung persönlich bestätigen',
    updated_at = now()
where gate_key = 'decision_or_escalation'
  and not exists (
    select 1
    from public.gate_template_settings existing
    where existing.gate_key = 'decision_confirmation'
  );

update public.gate_template_settings
set label = 'Entscheidung persönlich bestätigen',
    default_label = 'Entscheidung persönlich bestätigen',
    updated_at = now()
where gate_key = 'decision_confirmation';

update public.week_gates
set gate_key = 'decision_confirmation',
    label = 'Entscheidung persönlich bestätigen'
where gate_key = 'decision_or_escalation';

-- Historische Datensätze bleiben für die Nachvollziehbarkeit erhalten.
-- Die Anwendung liest oder erzeugt keine Coach-Fälle mehr.

commit;
