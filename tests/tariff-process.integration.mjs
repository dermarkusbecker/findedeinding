import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table user_profiles(id uuid primary key,role text);
 create table service_tariffs(id uuid primary key);
 create table leads(id uuid primary key,converted_user_profile_id uuid);
 create table lead_contracts(id uuid primary key,lead_id uuid,tariff_id uuid,status text,signed_at timestamptz,created_at timestamptz default now());
 insert into user_profiles values('10000000-0000-4000-8000-000000000001','user');`);
 for(const file of ['20260912090000_versioned_program_builder.sql','20260912113000_tariff_process_assignment.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 const versions=(await db.query(`insert into program_versions(definition) values(' {"name":"Tarif A"}'),('{"name":"Standard B"}') returning id,version`)).rows;
 await db.query('insert into service_tariffs(id,program_version_id) values($1,$2)', ['20000000-0000-4000-8000-000000000001',versions[0].id]);
 await db.exec(`insert into user_profiles values('10000000-0000-4000-8000-000000000002','user'),('10000000-0000-4000-8000-000000000003','user');
 insert into leads values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
 insert into lead_contracts(id,lead_id,tariff_id,status,signed_at) values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','signed',now());`);
 const assign=async id=>(await db.query('select assign_program_version($1) result',[id])).rows[0].result;
 assert.equal(await assign('10000000-0000-4000-8000-000000000001'),null);
 assert.equal((await assign('10000000-0000-4000-8000-000000000002')).version,1);
 assert.equal((await assign('10000000-0000-4000-8000-000000000003')).version,2);
 await db.query('update service_tariffs set program_version_id=$1',[versions[1].id]);
 assert.equal((await assign('10000000-0000-4000-8000-000000000002')).version,1);
 await db.exec('set role authenticated');await assert.rejects(assign('10000000-0000-4000-8000-000000000003'),/permission denied/);
 console.log('PASS: tariff-specific assignment, latest standard fallback, existing legacy and assigned customers unchanged, RPC authorization.');
}finally{await db.close();}
