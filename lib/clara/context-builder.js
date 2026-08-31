import { stepStatuses, weekOnePrompt } from '../week-one.js';

const compactMessage = (message) => ({ role: message.role, content: message.content, created_at: message.created_at });
const compactMemory = (memory) => ({ memory_type: memory.memory_type, topic: memory.topic, value: memory.value, source_week: memory.source_week, confidence: memory.confidence });

export function buildClaraContext({ participantId, participantName, week = 1, state, messages = [], memories = [], rawEntries = [] }) {
  const prompt = weekOnePrompt(state, participantName?.split(' ')[0] || '');
  const relevantTopics = new Set([
    `week_${week}`,
    state.current_step,
    state.active_wish === null ? '' : `wish_${state.active_wish + 1}`,
    'long_term_profile',
  ].filter(Boolean));
  const relevantMemories = memories
    .filter((item) => item.status !== 'superseded')
    .filter((item) => relevantTopics.has(item.topic) || ['recurring_theme', 'tension', 'open_question'].includes(item.memory_type))
    .slice(-30)
    .map(compactMemory);
  const rawMemory = rawEntries.slice(-12).map((entry) => ({ week: entry.week, data_block: entry.data_block, raw_answer: entry.raw_answer, created_at: entry.created_at }));
  return {
    participantId,
    participantName,
    week,
    state,
    openTask: { prompt, statuses: stepStatuses(state) },
    rawMemory,
    structuredMemory: relevantMemories,
    recentMessages: messages.slice(-8).map(compactMessage),
  };
}
