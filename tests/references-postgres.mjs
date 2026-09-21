const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role; create table user_profiles(id uuid primary key);');
const sql = await fs.readFile(new URL('../supabase/migrations/20260921190000_landing_references.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql);
assert.equal((await db.query('select enabled from landing_references')).rows[0].enabled, false);
await assert.rejects(() => db.exec("update landing_references set enabled=true"), /check constraint/);
await db.exec(`update landing_references set videos='[{"id":"M7lc1UVf-VE","url":"https://youtu.be/M7lc1UVf-VE"}]',enabled=true`);
await db.exec('update landing_references set enabled=false');
assert.equal((await db.query('select jsonb_array_length(videos) n from landing_references')).rows[0].n, 1);
assert.equal((await db.query("select relrowsecurity from pg_class where relname='landing_references'")).rows[0].relrowsecurity, true);
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query('select * from landing_references'), /permission denied/);
  await assert.rejects(() => db.exec('update landing_references set enabled=true'), /permission denied/);
  await db.exec('reset role');
}
console.log('Reference migration: idempotence, disabled default, activation constraint, retained links, RLS and denied direct public access passed');
await db.close();
