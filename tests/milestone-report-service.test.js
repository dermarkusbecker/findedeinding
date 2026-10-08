import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMilestoneReports } from '../lib/milestone-report-service.js';

const result = (completedWeeks) => ({
  service: { url: 'https://example.supabase.co', key: 'test' },
  profile: { name: 'Test' }, processVersion: { version: 2, definition: { weeks: Array.from({ length: 8 }, (_, index) => ({ title: `Woche ${index + 1}`, steps: [] })) } },
  curriculum: [], serializedAccess: { completedWeeks },
});

test('Berichte entstehen nur bei vollständigen Meilensteinen und bleiben bei erneutem Laden gespeichert', async () => {
  const previous = globalThis.fetch;
  const rows = [];
  const calls = [];
  globalThis.fetch = async (_url, options = {}) => {
    calls.push(options.method || 'GET');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      rows.push({ milestone_week: body.milestone_week, process_version: body.process_version, report: body.report, generated_at: '2026-10-08T12:00:00Z' });
      return { ok: true, json: async () => [rows.at(-1)] };
    }
    return { ok: true, json: async () => [...rows] };
  };
  let generations = 0;
  const generate = async ({ milestoneWeek }) => { generations++; return { title: `Bericht ${milestoneWeek}`, generator: 'test', model: null, version: 'test' }; };
  try {
    const args = { participantId: 'test', generate };
    assert.deepEqual(await ensureMilestoneReports({ ...args, result: result([1, 2, 3]) }), []);
    assert.equal(generations, 0);
    assert.deepEqual((await ensureMilestoneReports({ ...args, result: result([1, 2, 3, 4]) })).map((item) => item.milestoneWeek), [4]);
    assert.deepEqual((await ensureMilestoneReports({ ...args, result: result([1, 2, 3, 4, 5, 6, 7, 8]) })).map((item) => item.milestoneWeek), [4, 8]);
    await ensureMilestoneReports({ ...args, result: result([1, 2, 3, 4, 5, 6, 7, 8]) });
    assert.equal(generations, 2);
    assert.equal(calls.filter((method) => method === 'POST').length, 2);
  } finally { globalThis.fetch = previous; }
});
