const correctionActions = new Set(['correct_wish', 'correct_guided_answer']);

export function processEligibleStateSuggestions(response = {}) {
  const suggestions = Array.isArray(response.suggested_state_updates) ? response.suggested_state_updates : [];
  const ready = response.needs_followup === false
    && response.next_action?.type === 'advance_if_valid'
    && ['completed', 'confirmed'].includes(response.step_status);
  return suggestions.filter((item) => item?.action === 'none' || correctionActions.has(item?.action) || ready);
}

export function sanitizeClaraProcessMessage(message, currentWeek) {
  const week = Number(currentWeek);
  const parts = String(message || '').split(/(?<=[.!?])\s+|\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const kept = parts.filter((part) => {
    if (/\b(?:nächste[snr]?|kommende[snr]?|spätere[snr]?)\s+wochen?\b/i.test(part)) return false;
    if (/\b(?:in den|für die)\s+(?:nächsten|kommenden|späteren)\s+wochen\b/i.test(part)) return false;
    const mentionedWeeks = [...part.matchAll(/\b(?:in|ab|bei)\s+woche\s+([1-8])\b/gi)].map((match) => Number(match[1]));
    return !mentionedWeeks.some((mentionedWeek) => Number.isInteger(week) && mentionedWeek > week);
  });
  return kept.join('\n\n') || 'Danke. Wir bleiben bei deinem aktuellen Schritt.';
}

export function buildStepTransition({ beforeState, afterState, nextPrompt = '', weekComplete = false, validatedComplete = true } = {}) {
  const fromStep = beforeState?.current_step || null;
  const toStep = afterState?.current_step || null;
  const advanced = Boolean(validatedComplete && fromStep && fromStep !== toStep);
  return {
    ready: advanced,
    advanced,
    fromStep,
    toStep,
    nextPrompt: advanced && toStep ? String(nextPrompt || '').trim() : '',
    weekComplete: Boolean(advanced && !toStep && weekComplete),
  };
}
