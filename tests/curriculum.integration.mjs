const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create table user_profiles(id uuid primary key,role text);insert into user_profiles values('00000000-0000-4000-8000-000000000001','user');`);
await db.exec("create table service_tariffs(id uuid,code text,program_version_id uuid);insert into service_tariffs values('00000000-0000-4000-8000-000000000002','fdd-8-wochen',null);");
for(const name of ['20260912090000_versioned_program_builder.sql','20260915210000_named_builder_drafts.sql','20260916100000_curriculum_4plus4.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
const {rows:[version]}=await db.query('select version,definition from program_versions');assert.equal(version.definition.weeks.length,8);
assert.equal((await db.query('select * from curriculum_assignment_archive')).rows.length,1);
const user='00000000-0000-4000-8000-000000000001';
const payload={status:'completed',ready:true,messages:[{role:'user',content:'Original remains'}],summary:'Test',structured_data:{},signals:[]};
async function save(step,revision=0){return db.query('select save_curriculum_lesson($1,$2,1,$3,$4,$5)',[user,version.version,step,revision,payload]);}
await assert.rejects(save('week_complete_1'));
await save('c44_w1_l1');await assert.rejects(save('c44_w1_l1'));
await save('c44_w1_l1',1);
for(const s of version.definition.weeks[0].steps.slice(1))await save(s.id);
await save('c44_w1_l1',2);assert.ok((await db.query("select requires_review from curriculum_lessons where step_id='c44_w1_l2'")).rows[0].requires_review);for(const step of version.definition.weeks[0].steps.slice(1)){const {rows:[r]}=await db.query('select revision from curriculum_lessons where step_id=$1',[step.id]);await save(step.id,r.revision);}await save('week_complete_1');await assert.rejects(save('c44_w1_l1',2));
console.log('PASS: migration, assignment archive, 39 lessons, optimistic revision, required lessons and finalization lock');await db.close();
