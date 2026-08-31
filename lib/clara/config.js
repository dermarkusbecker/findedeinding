export const CLARA_SCHEMA_VERSION = '1.0';
export const CLARA_PROMPT_VERSION = '2026-08-31.1';

export function claraConfig(env = process.env) {
  return {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.CLARA_OPENAI_MODEL || 'gpt-5.6-terra',
    reasoningEffort: env.CLARA_REASONING_EFFORT || 'low',
    maxOutputTokens: Number(env.CLARA_MAX_OUTPUT_TOKENS || 1800),
  };
}
