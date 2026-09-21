-- Preserve previous copy for review; automation activation states remain unchanged.
create table if not exists public.communication_template_copy_backup_20260921 as select * from public.communication_templates;
alter table public.communication_template_copy_backup_20260921 enable row level security;
alter table public.lead_communications add column if not exists body_html text;
update public.communication_templates set subject='Schön, dass du da bist, {{vorname}}', body='Hallo {{vorname}},

vielen Dank für deine Anfrage und dein Vertrauen. Der erste Schritt ist gemacht: Du hast dir Zeit genommen, genauer auf deine Wünsche und deine aktuelle Situation zu schauen.

Im Klarheitsgespräch lernen wir uns kennen. Wir sprechen darüber, was dich gerade beschäftigt, was sich verändern soll und ob Finde dein Ding dich dabei unterstützen kann. Du musst dafür noch keine fertige Antwort haben.

Falls du bereits einen Termin gewählt hast, findest du die Einzelheiten in deiner Terminbestätigung. Ansonsten stimmen wir den nächsten Schritt mit dir ab.

Ich freue mich darauf, dich kennenzulernen.', updated_at=now() where template_key='welcome_lead';
update public.communication_templates set subject='Dein Klarheitsgespräch am {{datum}} um {{uhrzeit}} Uhr', body='Hallo {{vorname}},

ich freue mich auf unser Gespräch am {{datum}} um {{uhrzeit}} Uhr (Europe/Berlin). Plane dafür bitte {{dauer}} Minuten ein.

Dein Zugang zu Google Meet:
{{meet_link}}

Such dir einen ruhigen Ort und prüfe kurz Mikrofon und Kamera. Du brauchst keine Präsentation und keine vorbereiteten Antworten – bring einfach deine Fragen und das mit, was dich gerade beschäftigt.

Falls du den Termin nicht wahrnehmen kannst, gib uns bitte rechtzeitig Bescheid, damit wir einen neuen Zeitpunkt finden.', updated_at=now() where template_key='appointment_reminder';
update public.communication_templates set subject='So kannst du dich auf unser Gespräch vorbereiten', body='Hallo {{vorname}},

am {{datum}} um {{uhrzeit}} Uhr (Europe/Berlin) nehmen wir uns {{dauer}} Minuten Zeit für dich und deine aktuelle Situation.

Wenn du magst, denk vorher über drei Fragen nach:
Was läuft in deinem Leben gut und soll bleiben?
Was kostet dich gerade Energie oder hält dich zurück?
Woran würdest du merken, dass unser Gespräch hilfreich war?

Ein paar Stichworte reichen. Du musst noch nicht wissen, was dein Ding ist. Genau dort setzen wir gemeinsam an.

Hier findest du unser Gespräch:
{{meet_link}}

Ich freue mich auf einen offenen Austausch mit dir.', updated_at=now() where template_key='appointment_preparation';
update public.communication_templates set subject='Dein nächster Schritt bei Finde dein Ding', body='Hallo {{vorname}},

dein Vertragsabschluss ist bestätigt. Danke für dein Vertrauen – ich freue mich darauf, dich auf deinem Weg zu begleiten.

Die Informationen zu deinem persönlichen Zugang erhältst du separat. Dort findest du deinen Prozess und die nächsten Schritte.

In den ersten vier Wochen geht es darum, herauszufinden, was wirklich zu dir passt. In den folgenden vier Wochen übersetzt du deine Erkenntnisse in eine Richtung, die du im Alltag erproben kannst.

Clara begleitet dich im Chat. In den Wochen- und Monatscalls sowie bei den Q&As bin ich persönlich für deine Fragen an deiner Seite.

Du musst nicht alles auf einmal lösen. Wir gehen Schritt für Schritt.', updated_at=now() where template_key='contract_completed';
update public.communication_templates set subject='Dein persönlicher Bereich ist bereit, {{vorname}}', body='Hallo {{vorname}},

willkommen bei Finde dein Ding! Dein persönlicher Bereich ist jetzt bereit.

Dein Benutzername: {{login_name}}

Über diesen persönlichen Link richtest du dein Passwort ein:
{{login_link}}

Bitte behalte den Link für dich. Sobald du deinen Zugang eingerichtet hast, kannst du in „Mein Bereich“ mit Woche 1 starten. Clara führt dich im Gespräch durch die einzelnen Themen.

Du kannst jederzeit eine Pause machen und später anknüpfen. Solange eine Woche noch nicht abgeschlossen ist, kannst du deine Antworten im Chat ergänzen oder korrigieren.

Falls beim Einstieg etwas nicht funktioniert, melde dich bei uns. Schön, dass du dabei bist.', updated_at=now() where template_key='participant_access';
update public.communication_templates set subject='Woche {{woche}} wartet auf dich: {{wochen_titel}}', body='Hallo {{vorname}},

Woche {{woche}} ist jetzt für dich geöffnet. Dein nächstes Thema lautet: {{wochen_titel}}.

Öffne deinen persönlichen Bereich und setze dein Gespräch mit Clara fort:
{{portal_link}}

Nimm dir einen ruhigen Moment und antworte so, wie es für dich gerade stimmt. Es geht nicht um perfekte Antworten, sondern darum, deine Wünsche, Erfahrungen und nächsten Schritte klarer zu sehen.

Fragen, die dabei auftauchen, kannst du in unsere Calls und Q&As mitbringen. Ich begleite dich bei der Einordnung und Umsetzung.', updated_at=now() where template_key='week_unlocked';
update public.communication_templates set subject='Dein Weg läuft nicht weg – knüpfe wieder an', body='Hallo {{vorname}},

im Alltag bleibt manchmal wenig Raum für die eigenen Fragen. Deshalb kommt hier ein freundlicher Impuls: Dein Gespräch mit Clara wartet dort auf dich, wo du aufgehört hast.

Du musst nicht die ganze Woche auf einmal bearbeiten. Ein kleiner nächster Schritt reicht, um wieder einzusteigen.

Hier geht es zu deinem persönlichen Bereich:
{{portal_link}}

Wenn du festhängst oder sich deine Situation verändert hat, sprich es im Chat oder in einem unserer Calls an. Gemeinsam schauen wir, was du jetzt brauchst.', updated_at=now() where template_key='friendly_reminder';
