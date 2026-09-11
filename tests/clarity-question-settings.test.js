import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CLARITY_QUESTION_CATALOG,
  clarityQuestionSeedRows,
  defaultClarityQuestion,
  readClarityQuestionOverrides,
  resolveClarityQuestionConfig,
  resolveClarityPrompt,
} from '../lib/clarity-questions.js';

test('Fragenkatalog deckt alle acht Prozesswochen eindeutig ab', () => {
  assert.deepEqual([...new Set(CLARITY_QUESTION_CATALOG.map((item) => item.week))], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(CLARITY_QUESTION_CATALOG.map((item) => item.questionKey)).size, CLARITY_QUESTION_CATALOG.length);
  assert.ok(CLARITY_QUESTION_CATALOG.length >= 50);
  assert.equal(clarityQuestionSeedRows().length, CLARITY_QUESTION_CATALOG.length);
  assert.equal(defaultClarityQuestion('1.THREE_WISHES_COLLECTION')?.week, 1);
  assert.match(defaultClarityQuestion('3.motivators')?.completionCriteria || '', /Genau 5/);
  assert.ok(defaultClarityQuestion('2.education')?.guidanceText.length > 10);
});

test('Prozessbaukasten liefert Frage, Clara-Details und Abschlusskriterien gemeinsam aus', () => {
  const overrides = [{
    question_key: '2.education',
    prompt_text: 'Welche Qualifikationen bringst du mit?',
    guidance_text: 'Frage bei unklaren Abschlüssen einmal nach.',
    completion_criteria: 'Mindestens eine konkrete Qualifikation oder eine eindeutige Negativantwort ist erfasst.',
  }];
  const configured = resolveClarityQuestionConfig(overrides, 2, 'education', { promptText: 'Fallback' });
  assert.equal(configured.promptText, overrides[0].prompt_text);
  assert.equal(configured.guidanceText, overrides[0].guidance_text);
  assert.equal(configured.completionCriteria, overrides[0].completion_criteria);
});

test('individuelle Admin-Frage überschreibt den Standard, Reset erhält dynamische Rückfragen', () => {
  const fallback = 'Dynamische Rückfrage';
  const custom = [{ question_key: '1.WISH_1_DEEPENING', prompt_text: 'Meine individuelle Frage?', default_prompt_text: 'Standardfrage' }];
  const reset = [{ question_key: '1.WISH_1_DEEPENING', prompt_text: 'Standardfrage', default_prompt_text: 'Standardfrage' }];
  assert.equal(resolveClarityPrompt(custom, 1, 'WISH_1_DEEPENING', fallback), 'Meine individuelle Frage?');
  assert.equal(resolveClarityPrompt(reset, 1, 'WISH_1_DEEPENING', fallback), fallback);
  assert.equal(resolveClarityPrompt([], 1, 'WISH_1_DEEPENING', fallback), fallback);
});

test('Fragenabruf filtert nur bei ausdrücklich gewählter Woche', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => [] };
  };
  try {
    await readClarityQuestionOverrides({ url: 'https://example.supabase.co', key: 'service-key' });
    await readClarityQuestionOverrides({ url: 'https://example.supabase.co', key: 'service-key' }, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.doesNotMatch(urls[0], /week=eq\./);
  assert.match(urls[1], /week=eq\.4/);
});

test('Admin-API schützt und persistiert die konfigurierten Fragen', async () => {
  const [api, participantApi, claraApi] = await Promise.all([
    readFile(new URL('../api/clarity.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/participant-program.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/clara/api-handler.js', import.meta.url), 'utf8'),
  ]);
  assert.match(api, /requireCurrentAdmin/);
  assert.match(api, /action === 'settings'/);
  assert.match(api, /request\.method === 'GET'/);
  assert.match(api, /request\.method !== 'PATCH'/);
  assert.match(api, /action === 'reset'/);
  assert.match(api, /2\.000 Zeichen/);
  assert.match(api, /completionCriteria/);
  assert.match(api, /guidanceText/);
  assert.match(participantApi, /readClarityQuestionOverrides/);
  assert.match(participantApi, /resolveClarityPrompt/);
  assert.match(claraApi, /readClarityQuestionOverrides/);
  assert.match(claraApi, /resolveClarityPrompt/);
});
