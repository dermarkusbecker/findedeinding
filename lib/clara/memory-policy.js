const memoryTypes = new Set(['structured_fact', 'recurring_theme', 'tension', 'insight', 'open_question', 'preference', 'career_station']);

export function validatedMemoryUpdates(updates = [], participantMessage = '') {
  return updates.filter((update) => {
    if (!update || !['add', 'supersede'].includes(update.operation) || !memoryTypes.has(update.memory_type)) return false;
    if (typeof update.topic !== 'string' || !update.topic.trim() || typeof update.value !== 'string' || !update.value.trim()) return false;
    if (typeof update.confidence !== 'number' || update.confidence < .55 || update.confidence > 1) return false;
    return true;
  }).map((update) => ({ ...update, topic: update.topic.trim().slice(0, 120), value: update.value.trim().slice(0, 4000), reason: String(update.reason || '').slice(0, 300) }));
}

export function validatedExtractions(items = [], participantMessage = '') {
  return items.filter((item) => item && typeof item.source_quote === 'string' && item.source_quote && participantMessage.includes(item.source_quote) && typeof item.value === 'string' && item.value.trim()).slice(0, 12);
}
