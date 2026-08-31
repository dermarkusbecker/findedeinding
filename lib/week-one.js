export const WEEK_ONE_STEPS = Object.freeze({
  ENTRY: 'WEEK_1_ENTRY',
  WISHES: 'THREE_WISHES_COLLECTION',
  WISH_1: 'WISH_1_DEEPENING',
  WISH_2: 'WISH_2_DEEPENING',
  WISH_3: 'WISH_3_DEEPENING',
  TARGET: 'FDD_TARGET_STATE',
  TARGET_CLARIFY: 'FDD_TARGET_CLARIFY',
  CLARITY: 'CLARITY_BASELINE',
  CAREER_CHOICE: 'CAREER_HISTORY',
  CAREER_DIALOG: 'CAREER_DIALOG_RECONSTRUCTION',
  CAREER_CONFIRM: 'CAREER_CONFIRM',
  CAREER_CV: 'CAREER_CV_REVIEW',
  REVIEW: 'WEEK_1_REVIEW',
});

const blankWish = (id) => ({
  id: `wish_${id}`,
  raw_wish: '',
  current_state: '',
  desired_state: '',
  underlying_need: '',
  emotional_meaning: '',
  change_pressure: '',
  voluntary_details: [],
  followup_count: 0,
  answer_quality: null,
  completed: false,
});

export function createWeekOneState() {
  return {
    version: 1,
    status: 'in_progress',
    current_step: WEEK_ONE_STEPS.ENTRY,
    active_wish: null,
    wishes: [blankWish(1), blankWish(2), blankWish(3)],
    fdd_target: { raw_answer: '', desired_result: '', desired_change: '', desired_implementation_state: '', clarification_raw: '', completed: false },
    clarity_baseline: { score: null, reason_raw: '', completed: false },
    career_history: { cv_uploaded: false, cv_file_id: null, cv_file_name: null, stations: [], source: null, participant_confirmed: false, completed: false },
    week_summary: null,
    completed_at: null,
    updated_at: null,
  };
}

export function normalizeWhitespace(value = '') {
  return String(value).trim().replace(/\s+/g, ' ');
}

export function meaningfulWords(value = '') {
  return normalizeWhitespace(value).split(' ').map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((part) => /[\p{L}\p{N}]/u.test(part));
}

export function validateMinWords(value, minimum = 6) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return { valid: false, reason: 'EMPTY', normalized, wordCount: 0 };
  const wordCount = meaningfulWords(normalized).length;
  if (wordCount < minimum) return { valid: false, reason: 'TOO_SHORT', normalized, wordCount };
  return { valid: true, reason: null, normalized, wordCount };
}

export function answerQuality(value = '') {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized || /^(weiß|weiss) (ich )?nicht[.!]?$/.test(normalized) || /keine ahnung/.test(normalized)) return 'unclear';
  const words = meaningfulWords(normalized);
  const unique = new Set(words.map((word) => word.toLowerCase()));
  if (/\b(irgendwie|irgendwann|einfach glücklicher|sehr viel geld)\b/.test(normalized) || (words.length >= 6 && unique.size / words.length < .58)) return 'thin';
  return 'sufficient';
}

export function targetNeedsClarification(value = '') {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return /\bklarheit\b/.test(normalized) && !/\b(entscheide|entscheidung|konkret|erkenne|weiß|weiss|umsetze|handle|richtung|schritt|beruf|tätigkeit)\b/.test(normalized);
}

export function asksForCareerRecommendation(value = '') {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return /(?:welcher|welche|was für ein)\s+(?:beruf|job|tätigkeit)|(?:beruf|job|tätigkeit).*(?:passt|empfiehl)/.test(normalized);
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || createWeekOneState()));
}

function nextIncompleteWish(state) {
  return state.wishes.findIndex((wish) => !wish.completed);
}

function wishStep(index) {
  return [WEEK_ONE_STEPS.WISH_1, WEEK_ONE_STEPS.WISH_2, WEEK_ONE_STEPS.WISH_3][index];
}

export function stepStatuses(state = createWeekOneState()) {
  const wishesComplete = state.wishes.every((wish) => wish.completed);
  const wishesStarted = state.wishes.some((wish) => wish.raw_wish || wish.followup_count);
  return [
    { id: 'wishes', title: 'Drei Wünsche vertieft', subtitle: 'Alle drei Wünsche verstanden', status: wishesComplete ? 'completed' : wishesStarted ? 'in_progress' : 'open' },
    { id: 'target', title: 'Dein Ziel festgehalten', subtitle: 'Was soll nach acht Wochen anders sein?', status: state.fdd_target.completed ? 'completed' : state.fdd_target.raw_answer ? 'in_progress' : 'open' },
    { id: 'clarity', title: 'Klarheits-Baseline gesetzt', subtitle: 'Dein heutiger Wert von 1 bis 10', status: state.clarity_baseline.completed ? 'completed' : 'open' },
    { id: 'career', title: 'Beruflicher Weg vollständig', subtitle: 'Lebenslauf oder gemeinsamer Rückblick', status: state.career_history.completed ? 'completed' : state.career_history.source ? 'in_progress' : 'open' },
  ];
}

export function weekOneComplete(state, preconditions = {}) {
  return Boolean(
    preconditions.privacyConsent
    && preconditions.startCommitment
    && state?.wishes?.length === 3
    && state.wishes.every((wish) => wish.completed)
    && state.fdd_target?.completed
    && Number(state.clarity_baseline?.score) >= 1
    && Number(state.clarity_baseline?.score) <= 10
    && state.career_history?.completed
  );
}

export function missingWeekOneRequirements(state, preconditions = {}) {
  const missing = [];
  if (!preconditions.privacyConsent) missing.push('Datenschutz-Einwilligung');
  if (!preconditions.startCommitment) missing.push('unterschriebenes persönliches Commitment');
  (state.wishes || []).forEach((wish, index) => { if (!wish.completed) missing.push(`Vertiefung Wunsch ${index + 1}`); });
  if (!state.fdd_target?.completed) missing.push('dein Ziel nach acht Wochen');
  if (!(Number(state.clarity_baseline?.score) >= 1 && Number(state.clarity_baseline?.score) <= 10)) missing.push('Klarheitswert');
  if (!state.career_history?.completed) missing.push('vollständiger beruflicher Weg');
  return missing;
}

export function weekOnePrompt(state = createWeekOneState(), firstName = '') {
  const first = firstName ? ` ${firstName}` : '';
  if (state.current_step === WEEK_ONE_STEPS.ENTRY) return { title: `Hallo${first}, jetzt geht es richtig los.`, help: 'In dieser ersten Woche möchte ich verstehen, wo du heute stehst, was du dir wirklich wünschst und was sich durch Finde dein Ding für dich verändern soll. Danach schauen wir uns deinen bisherigen beruflichen Weg an. Wir machen das Schritt für Schritt. Ich stelle dir immer nur eine Frage nach der anderen.', type: 'entry' };
  if (state.current_step === WEEK_ONE_STEPS.WISHES) return { title: 'Deine drei Wünsche', question: 'Stell dir vor, vor dir steht eine Fee und du hast genau drei Wünsche frei. Welche drei Dinge würdest du dir für dein Leben aktuell am meisten wünschen?', help: 'Nenne zunächst einfach alle drei. Formuliere jeden Wunsch bitte als ganzen Satz mit mindestens 6 Wörtern.', type: 'wishes' };
  if ([WEEK_ONE_STEPS.WISH_1, WEEK_ONE_STEPS.WISH_2, WEEK_ONE_STEPS.WISH_3].includes(state.current_step)) {
    const index = Number(state.current_step.match(/WISH_(\d)/)?.[1] || 1) - 1;
    const wish = state.wishes[index];
    const question = wish.answer_quality === 'thin' || wish.answer_quality === 'unclear' || wish.followup_count > 0
      ? 'Wenn du das zusammenfasst: Worum geht es dir dabei im Kern?'
      : 'Was würde sich in deinem Leben konkret verändern, wenn dieser Wunsch erfüllt wäre?';
    const transition = index === 0 ? 'Danke. Ich habe deine drei Wünsche. Jetzt möchte ich jeden davon kurz mit dir genauer anschauen.' : 'Danke. Ich verstehe jetzt besser, was hinter diesem Wunsch für dich steckt.';
    return { title: `Dein ${['erster', 'zweiter', 'dritter'][index]} Wunsch`, transition, quote: wish.raw_wish, question, help: 'Antworte so konkret, wie es sich für dich gerade stimmig anfühlt.', type: 'wish_followup', wishIndex: index };
  }
  if (state.current_step === WEEK_ONE_STEPS.TARGET) return { title: 'Dein Ziel', question: 'Stell dir vor, die acht Wochen sind vorbei und du blickst auf unseren gemeinsamen Prozess zurück. Was müsste sich für dich konkret verändert haben, damit du am Ende sagst: Finde dein Ding hat sich für mich wirklich gelohnt?', help: 'Formuliere deine Antwort bitte mit mindestens 6 Wörtern.', type: 'target' };
  if (state.current_step === WEEK_ONE_STEPS.TARGET_CLARIFY) return { title: 'Dein Ziel', question: 'Was bedeutet Klarheit für dich konkret? Woran würdest du nach den acht Wochen merken: Jetzt habe ich sie?', type: 'target_clarify' };
  if (state.current_step === WEEK_ONE_STEPS.CLARITY) return { title: 'Wo stehst du heute?', question: 'Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?', help: '1 bedeutet: überhaupt nicht klar. 10 bedeutet: glasklar.', type: 'clarity' };
  if (state.current_step === WEEK_ONE_STEPS.CAREER_CHOICE) return { title: 'Dein bisheriger Weg', question: 'Jetzt möchte ich deinen bisherigen beruflichen Weg kennenlernen.', help: 'Wenn du einen aktuellen Lebenslauf hast, kannst du ihn gerne hochladen. Wenn nicht, ist das überhaupt kein Problem. Dann gehen wir deinen bisherigen Weg gemeinsam durch.', type: 'career_choice' };
  if (state.current_step === WEEK_ONE_STEPS.CAREER_DIALOG) return { title: 'Dein bisheriger Weg', question: 'Was waren bisher die wichtigsten beruflichen Stationen in deinem Leben?', help: 'Nenne die Stationen, die für deinen bisherigen Weg wesentlich waren.', type: 'career_dialog' };
  if (state.current_step === WEEK_ONE_STEPS.CAREER_CV) return { title: 'Dein bisheriger Weg', question: 'Welche wesentlichen Stationen stehen in deinem Lebenslauf – und fehlt noch eine wichtige berufliche Station?', help: 'Ergänze oder korrigiere die Stationen und bestätige anschließend die Vollständigkeit.', type: 'career_cv' };
  if (state.current_step === WEEK_ONE_STEPS.CAREER_CONFIRM) return { title: 'Dein bisheriger Weg', question: 'Ist dein bisheriger beruflicher Weg damit im Wesentlichen vollständig?', type: 'career_confirm' };
  return { title: 'Damit haben wir deine erste Bestandsaufnahme geschafft.', help: 'Ich weiß jetzt, was du dir aktuell besonders wünschst, was sich durch Finde dein Ding für dich verändern soll, wie klar dein Ding heute schon für dich ist und welche beruflichen Stationen hinter dir liegen. Das ist unsere Ausgangsbasis für die nächsten Wochen.', type: 'review' };
}

export function applyWeekOneAction(inputState, action = {}) {
  const state = cloneState(inputState);
  const fail = (error, details = {}) => ({ ok: false, error, details, state });
  const finish = () => { state.updated_at = new Date().toISOString(); return { ok: true, state }; };

  if (action.type === 'begin') { state.current_step = WEEK_ONE_STEPS.WISHES; return finish(); }
  if (action.type === 'correct_wish') {
    const index = Number(action.wishIndex);
    const wish = state.wishes[index];
    const validation = validateMinWords(action.wish);
    if (!wish || !Number.isInteger(index) || index < 0 || index > 2) return fail('Diesen Wunsch konnte ich nicht zuordnen.', { reason: 'INVALID_WISH_INDEX' });
    if (!validation.valid) return fail('Beschreib deinen korrigierten Wunsch bitte als ganzen Satz mit mindestens 6 Wörtern.', { reason: validation.reason });
    state.wishes[index] = {
      ...blankWish(index + 1),
      raw_wish: validation.normalized,
      desired_state: validation.normalized,
      answer_quality: answerQuality(validation.normalized),
    };
    state.active_wish = index;
    state.status = 'in_progress';
    state.completed_at = null;
    state.current_step = wishStep(index);
    return finish();
  }
  if (action.type === 'save_wishes') {
    const wishes = Array.isArray(action.wishes) ? action.wishes : [];
    if (wishes.length !== 3) return fail('Bitte nenne genau drei Wünsche.', { reason: 'REQUIRED_WISH_COUNT' });
    const validations = wishes.map((wish) => validateMinWords(wish));
    if (validations.some((item) => !item.valid)) return fail('Beschreib deinen Wunsch bitte noch etwas genauer. Formuliere ihn als ganzen Satz mit mindestens 6 Wörtern.', { reason: 'INVALID_WISHES', validations });
    state.wishes = validations.map((item, index) => ({ ...state.wishes[index], raw_wish: item.normalized, desired_state: item.normalized, answer_quality: answerQuality(item.normalized) }));
    state.active_wish = 0;
    state.current_step = WEEK_ONE_STEPS.WISH_1;
    return finish();
  }
  if (action.type === 'save_wish_followup') {
    const index = Number(action.wishIndex);
    const wish = state.wishes[index];
    const answer = normalizeWhitespace(action.answer);
    if (!wish || !answer) return fail('Erzähl mir bitte noch ein wenig mehr zu diesem Wunsch.', { reason: 'EMPTY' });
    if (asksForCareerRecommendation(answer)) return fail('Dafür sammeln wir gerade erst die Puzzleteile. Ich möchte dir nicht zu früh eine Richtung einreden. Lass uns zuerst deine Ausgangsbasis sauber aufnehmen.', { reason: 'NO_EARLY_RECOMMENDATION' });
    wish.voluntary_details.push(answer);
    wish.followup_count += 1;
    wish.answer_quality = answerQuality(answer);
    wish.emotional_meaning = wish.emotional_meaning || answer;
    wish.underlying_need = wish.underlying_need || answer;
    const needsAnother = wish.answer_quality === 'unclear' && wish.followup_count < 3;
    if (!needsAnother) wish.completed = true;
    const next = nextIncompleteWish(state);
    if (needsAnother) { state.active_wish = index; state.current_step = wishStep(index); }
    else if (next >= 0) { state.active_wish = next; state.current_step = wishStep(next); }
    else { state.active_wish = null; state.current_step = WEEK_ONE_STEPS.TARGET; }
    return finish();
  }
  if (action.type === 'save_target') {
    const validation = validateMinWords(action.answer);
    if (!validation.valid) return fail('Beschreib bitte noch etwas genauer, was sich für dich verändern soll. Formuliere deine Antwort in mindestens 6 Wörtern.', { reason: validation.reason });
    if (asksForCareerRecommendation(validation.normalized)) return fail('Dafür sammeln wir gerade erst die Puzzleteile. Ich möchte dir nicht zu früh eine Richtung einreden. Lass uns zuerst deine Ausgangsbasis sauber aufnehmen.', { reason: 'NO_EARLY_RECOMMENDATION' });
    state.fdd_target.raw_answer = validation.normalized;
    state.fdd_target.desired_result = validation.normalized;
    if (targetNeedsClarification(validation.normalized)) state.current_step = WEEK_ONE_STEPS.TARGET_CLARIFY;
    else { state.fdd_target.completed = true; state.current_step = WEEK_ONE_STEPS.CLARITY; }
    return finish();
  }
  if (action.type === 'clarify_target') {
    const answer = normalizeWhitespace(action.answer);
    if (!answer) return fail('Woran würdest du die Veränderung konkret bemerken?', { reason: 'EMPTY' });
    state.fdd_target.clarification_raw = answer;
    state.fdd_target.desired_change = answer;
    state.fdd_target.completed = true;
    state.current_step = WEEK_ONE_STEPS.CLARITY;
    return finish();
  }
  if (action.type === 'save_clarity') {
    const score = Number(action.score);
    if (!Number.isInteger(score) || score < 1 || score > 10) return fail('Bitte wähle einen Klarheitswert zwischen 1 und 10.', { reason: 'INVALID_CLARITY' });
    state.clarity_baseline = { score, reason_raw: normalizeWhitespace(action.reason), completed: true };
    state.current_step = WEEK_ONE_STEPS.CLARITY;
    return finish();
  }
  if (action.type === 'continue_clarity') {
    state.clarity_baseline.reason_raw = normalizeWhitespace(action.reason);
    state.current_step = WEEK_ONE_STEPS.CAREER_CHOICE;
    return finish();
  }
  if (action.type === 'choose_career_dialog') { state.career_history.source = action.source === 'speech' ? 'speech' : 'dialog'; state.current_step = WEEK_ONE_STEPS.CAREER_DIALOG; return finish(); }
  if (action.type === 'cv_uploaded') {
    state.career_history.cv_uploaded = true;
    state.career_history.cv_file_id = normalizeWhitespace(action.fileId || action.fileName);
    state.career_history.cv_file_name = normalizeWhitespace(action.fileName);
    state.career_history.source = 'cv_upload';
    state.career_history.stations = Array.isArray(action.stations) ? action.stations.map((station) => ({ ...station, source: 'cv_upload' })) : [];
    state.career_history.completed = false;
    state.current_step = WEEK_ONE_STEPS.CAREER_CV;
    return finish();
  }
  if (action.type === 'save_career_history') {
    const answer = normalizeWhitespace(action.answer);
    if (!answer) return fail('Nenne bitte die wichtigsten Stationen deines bisherigen beruflichen Weges.', { reason: 'EMPTY' });
    state.career_history.stations.push({ role: null, company: null, industry: null, from: null, to: null, description_raw: answer, relevant_details: [], source: state.career_history.source || 'dialog' });
    state.career_history.participant_confirmed = Boolean(action.confirmed);
    state.career_history.completed = Boolean(action.confirmed);
    state.current_step = action.confirmed ? WEEK_ONE_STEPS.REVIEW : WEEK_ONE_STEPS.CAREER_CONFIRM;
    return finish();
  }
  if (action.type === 'confirm_career') {
    if (action.complete !== true) { state.current_step = state.career_history.source === 'cv_upload' ? WEEK_ONE_STEPS.CAREER_CV : WEEK_ONE_STEPS.CAREER_DIALOG; return finish(); }
    state.career_history.participant_confirmed = true;
    state.career_history.completed = true;
    state.current_step = WEEK_ONE_STEPS.REVIEW;
    return finish();
  }
  return fail('Unbekannter Schritt in Woche 1.', { reason: 'UNKNOWN_ACTION' });
}
