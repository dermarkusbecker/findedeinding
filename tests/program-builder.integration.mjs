import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaultProgramDefinition } from "../lib/program-builder.js";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create table user_profiles(id uuid primary key,role text);insert into user_profiles values('10000000-0000-4000-8000-000000000001','user'),('10000000-0000-4000-8000-000000000002','admin');",
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260912090000_versioned_program_builder.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const def = defaultProgramDefinition();
  const admin = "10000000-0000-4000-8000-000000000002";
  const save = async (revision, publish) =>
    (
      await db.query("select save_program_builder($1,$2,$3,$4) result", [
        def,
        revision,
        publish,
        admin,
      ])
    ).rows[0].result;
  const assign = async (id) =>
    (await db.query("select assign_program_version($1) result", [id])).rows[0]
      .result;
  assert.equal((await save(0, false)).revision, 1);
  await assert.rejects(save(0, true), /zwischenzeitlich/);
  assert.equal((await save(1, true)).version, 1);
  assert.equal(await assign("10000000-0000-4000-8000-000000000001"), null);
  await db.exec(
    "insert into user_profiles values('10000000-0000-4000-8000-000000000003','user');",
  );
  assert.equal(
    (await assign("10000000-0000-4000-8000-000000000003")).version,
    1,
  );
  def.name = "Neue Version";
  assert.equal((await save(2, true)).version, 2);
  assert.equal(
    (await assign("10000000-0000-4000-8000-000000000003")).version,
    1,
  );
  await db.exec(
    "insert into user_profiles values('10000000-0000-4000-8000-000000000004','user');",
  );
  assert.equal(
    (await assign("10000000-0000-4000-8000-000000000004")).version,
    2,
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    assign("10000000-0000-4000-8000-000000000004"),
    /permission denied/,
  );
  console.log(
    "PASS: draft conflicts, publication, existing customers, immutable assignment, new customers and RPC permissions",
  );
} finally {
  await db.close();
}
