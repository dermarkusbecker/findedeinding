// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite ESM entry.
// Uses an isolated in-memory PostgreSQL database; never accesses customer data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGuidedWeekState } from '../lib/guided-weeks.js';
import { createWeekOneState } from '../lib/week-one.js';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table user_profiles(id uuid primary key, name text, source_lead_id uuid, status text, permissions text[]);
    create table participant_progress(user_profile_id uuid primary key, program_status text, privacy_consent_at timestamptz, start_commitment_at timestamptz, program_start_date date, last_activity_at timestamptz);
    create table process_entries(id uuid primary key default gen_random_uuid(), user_profile_id uuid references user_profiles, week integer, data_block text, raw_answer text, structured_data jsonb, evidence_level text, created_at timestamptz default clock_timestamp());
    create table leads(id uuid primary key default gen_random_uuid(), converted_user_profile_id uuid);
    create table lead_tasks(id uuid primary key default gen_random_uuid(), lead_id uuid references leads, title text, details text, due_at date, task_type text);
    create table customer_questions(id uuid primary key default gen_random_uuid(), user_profile_id uuid references user_profiles, week integer, question text);
  `);
  for (const migration of ['20260911190000_demo_full_access_week_writes.sql', '20260911200000_atomic_weekly_clarity.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const participant = '10000000-0000-4000-8000-000000000001';
  const lead = '20000000-0000-4000-8000-000000000001';
  await db.query(`insert into user_profiles values ($1, 'Testkunde', $2, 'active', array['demo_full_access'])`, [participant, lead]);
  await db.query(`insert into leads values ($1,$2)`, [lead, participant]);
  await db.query(`insert into participant_progress values ($1,'active',now(),now(),current_date,null)`, [participant]);
  const save = async (week, score, note = '') => {
    const initial = week === 1 ? createWeekOneState() : createGuidedWeekState(week);
    return (await db.query('select save_weekly_clarity($1,$2,$3,$4,$5) as result', [participant, week, score, note, initial])).rows[0].result;
  };
  assert.equal((await save(1, 3)).state.clarity_baseline.score, 3);
  assert.equal((await save(2, 5)).state.clarity_checkin.score, 5);
  assert.equal((await save(2, 5)).alreadySaved, true);
  assert.equal((await db.query('select count(*)::int as n from process_entries')).rows[0].n, 2);
  await assert.rejects(save(2, 6), /bereits ein anderer/);
  await assert.rejects(save(3, 4), /warum deine Klarheit/);
  assert.equal((await db.query('select count(*)::int as n from process_entries where week=3')).rows[0].n, 0);
  const decline = await save(3, 4, 'Neue Fragen beschäftigen mich.');
  assert.ok(decline.followUpId);
  await save(3, 4, 'Wiederholung nach Verbindungsabbruch');
  assert.equal((await db.query('select count(*)::int as n from lead_tasks')).rows[0].n, 1);
  assert.match((await db.query('select details from lead_tasks')).rows[0].details, /Neue Fragen/);
  await save(4, 4);
  assert.equal((await db.query('select count(*)::int as n from lead_tasks')).rows[0].n, 1);
  await db.exec(`alter table lead_tasks add constraint simulate_task_failure check (title = 'impossible') not valid`);
  await assert.rejects(save(5, 3, 'Ich bin unsicher.'), /simulate_task_failure/);
  assert.equal((await db.query('select count(*)::int as n from process_entries where week=5')).rows[0].n, 0);
  await db.exec('alter table lead_tasks drop constraint simulate_task_failure');
  await db.query('update user_profiles set source_lead_id=null where id=$1', [participant]);
  await db.query('update leads set converted_user_profile_id=null where id=$1', [lead]);
  const fallback = await save(5, 3, 'Ich weiß es noch nicht.');
  assert.ok(fallback.followUpId);
  assert.equal((await db.query('select count(*)::int as n from customer_questions')).rows[0].n, 1);
  await db.query("update user_profiles set permissions='{}' where id=$1", [participant]);
  await assert.rejects(save(6, 4), /noch nicht freigeschaltet/);
  await assert.rejects(save(0, 4), /gültige Woche/);
  await assert.rejects(save(2, 11), /gültige Woche/);
  const rows = (await db.query("select week, structured_data -> ('week_' || week) as state from process_entries order by week")).rows;
  assert.deepEqual(rows.map(({week, state}) => week === 1 ? state.clarity_baseline.score : state.clarity_checkin.score), [3,5,4,4,3]);
  console.log('PostgreSQL integration passed: persistence, retries, immutable values, decline reason, single follow-up, rollback, direct-customer fallback and release guard.');
} finally { await db.close(); }
