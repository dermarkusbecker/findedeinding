export const INTAKE_VERSION = 1;
export const INTAKE_QUESTIONS = [
  {
    "id": "job_feeling",
    "question": "Wie fühlt sich dein Job gerade an?",
    "options": [
      "Eigentlich ganz okay, aber da geht mehr",
      "Ich funktioniere nur noch",
      "Ich zähl die Tage bis Feierabend",
      "Ich weiß es selbst nicht genau"
    ],
    "optional": false
  },
  {
    "id": "main_concern",
    "question": "Was beschäftigt dich am meisten?",
    "options": [
      "Ich weiß nicht, was ich wirklich will",
      "Ich weiß es, trau mich aber nicht",
      "Ich hab zu viele Ideen, keine Klarheit",
      "Ich hab schon zu viel ausprobiert und nichts hat gepasst"
    ],
    "optional": false
  },
  {
    "id": "duration",
    "question": "Wie lange trägst du das Thema schon mit dir rum?",
    "options": [
      "Ein paar Monate",
      "Über ein Jahr",
      "Schon seit Jahren",
      "Gefühlt mein ganzes Berufsleben"
    ],
    "optional": false
  },
  {
    "id": "inaction",
    "question": "Wenn sich in den nächsten 5 Jahren nichts ändert – wie geht's dir dann?",
    "options": [
      "Gar nicht gut, das macht mir Angst",
      "Ich hab mich wahrscheinlich einfach dran gewöhnt",
      "Darüber will ich lieber nicht nachdenken"
    ],
    "optional": false
  },
  {
    "id": "future",
    "question": "Was wäre, wenn du in 12 Monaten genau wüsstest, was dein Ding ist?",
    "options": [
      "Endlich durchatmen",
      "Ich würde sofort loslegen",
      "Ich würde es kaum glauben"
    ],
    "optional": false
  },
  {
    "id": "barrier",
    "question": "Was hat dich bisher am meisten ausgebremst?",
    "options": [
      "Zeit",
      "Geld/Absicherung",
      "Angst vor der falschen Entscheidung",
      "Ich wusste nicht, wo ich anfangen soll"
    ],
    "optional": true
  }
];
export function normalizeIntake(answers) {
  if (!answers || typeof answers !== 'object') throw Object.assign(new Error('Bitte beantworte die Intake-Fragen.'), {status:400});
  return {version:INTAKE_VERSION, answers:INTAKE_QUESTIONS.map(q=>{
    const value=answers[q.id];
    if(q.optional && (value === undefined || value === null || value === '')) return {...q, answer:null, segment:null};
    if(!Number.isInteger(value) || value<0 || value>=q.options.length) throw Object.assign(new Error('Bitte beantworte: '+q.question),{status:400});
    return {id:q.id, question:q.question, answer:q.options[value], segment:q.id+'_'+(value+1)};
  })};
}
