const firstQuestions = {
 c44_w1_l2:'Wenn du auf eine typische Woche blickst: Was läuft in deinem Leben gerade gut und soll unbedingt bleiben?',
 c44_w1_l3:'Welche konkrete Situation hat dir in den letzten Tagen Energie gegeben?',
 c44_w1_l4:'Welche Entscheidung hat deinen bisherigen beruflichen Weg besonders geprägt – und warum hast du sie damals getroffen?',
 c44_w1_l5:'Welcher Gedanke aus unseren bisherigen Gesprächen ist dir besonders im Kopf geblieben?',
 c44_w2_l1:'Welchen dieser Momente möchtest du zuerst beschreiben?',
 c44_w2_l4:'Unter welchen Bedingungen fühlst du dich bei der Arbeit besonders wohl?',
 c44_w2_l5:'Welche Aussage aus deinem Chart möchtest du an einer konkreten Erfahrung überprüfen?',
 c44_w2_l6:'Was beschreibt deine Arbeitsweise aus deiner Sicht bisher am treffendsten?',
 c44_w3_l3:'Wo wachst du an diesem Dienstag auf und wie beginnt dein Morgen?',
 c44_w3_l5:'Welche drei Elemente deines Wunschlebens sind für dich nicht verhandelbar?',
 c44_w4_l1:'Welcher deiner bisherigen Wünsche oder Erfahrungen ist dir für diesen Überblick besonders wichtig?',
 c44_w4_l2:'Welches Thema erkennst du selbst in mehreren deiner bisherigen Erfahrungen wieder?',
 c44_w4_l4:'Welche mögliche Richtung möchtest du zuerst mit deinen bisherigen Erfahrungen abgleichen?',
 c44_w4_l5:'Welche Richtung willst du zuerst untersuchen – und warum?',
 c44_w6_l1:'Wie beginnt dieser Montag für dich?',
 c44_w7_l1:'Was ist heute der konkrete Schritt, mit dem du deine Idee in der Realität testest?',
 c44_w8_l1:'Was hat dir bei deinem Test tatsächlich Energie gegeben?',
 c44_w8_l5:'Was ist deine wichtigste Erkenntnis aus diesen acht Wochen?'
};
export function curriculumOpening(step){
 const opening=String(step.opening||'').trim().replace(/^[„“"]|[“”"]$/g,'');
 if(opening.includes('?'))return opening;
 const question=firstQuestions[step.id] || (String(step.question||'').match(/[^.!?]*\?/u)?.[0]?.trim()) || 'Was möchtest du dazu aus deiner eigenen Erfahrung erzählen?';
 return [opening,question].filter(Boolean).join('\n\n');
}
