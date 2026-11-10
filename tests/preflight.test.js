import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {testDB,budgetEnv} from './runtime-fixture.js';
import {inspectPreflight,READ_CONTRACTS} from '../lib/preflight.js';
import {onRequestGet} from '../functions/api/business/preflight.js';
const now=Date.parse('2026-11-11T03:00:00Z');
function setup(){const db=testDB();for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return db;}
const config=db=>({JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'private-password-marker',ANTHROPIC_API_KEY:'private-provider-marker',JARVIS_SCHEDULER_TOKEN:'private-scheduler-marker-12345678901234567890',CF_PAGES_BRANCH:'feature/ai-business-rebuild',...budgetEnv});
function readonly(db){return {prepare(sql){assert.match(sql,/^(?:SELECT\b|PRAGMA table_info\([a-z_]+\)$)/);const s=db.prepare(sql);return {bind(...args){s.bind(...args);return this;},first:()=>s.first(),all:()=>s.all(),run(){throw Error('Writes forbidden');}};},batch(){throw Error('Batch forbidden');}};}
const snapshot=db=>({schema:db.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all(),tables:Object.fromEntries(Object.keys(READ_CONTRACTS).filter(n=>db.db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(n)).map(n=>[n,db.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()]))});
function run(db,{state='running',expires=now-1,month='2026-11',charged=100,id='operation'}={}){db.db.prepare("INSERT INTO ai_operations(id,purpose,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at) VALUES(?,'chat','anthropic','fixture',?,?,100,?,3,15,?,?)").run(id,month,state,charged,now-1000,expires);}
function schedule(db){db.db.prepare("INSERT INTO collection_schedules VALUES('schedule','private-topic-marker','digital','private-keyword-marker',60,1,1,?,?)").run(now-1,now-1);}
function collectionRun(db,{id='run',state='running',expires=now-1,start=now-1000}={}){db.db.prepare("INSERT INTO collection_runs(id,schedule_id,schedule_version,due_at,state,started_at,expires_at) VALUES(?,'schedule',1,?,?,?,?)").run(id,start,state,start,expires);}
test('preflight reads existing structures and expired jobs without recovering, creating, reserving or exposing secrets',async()=>{
 const db=setup();schedule(db);run(db);collectionRun(db);const before=snapshot(db);const env=config(readonly(db));const r=await inspectPreflight(env,now);
 assert.equal(r.database.state,'columns_present');assert.equal(r.ai.expiredRunning,1);assert.equal(r.collection.snapshot.expiredRunning,1);assert.equal(r.collection.state,'disabled');assert.equal(r.productionReady,false);assert.ok(r.manualChecks.every(c=>c.state==='unverified'));assert.deepEqual(snapshot(db),before);
 const text=JSON.stringify(r);for(const secret of ['private-password-marker','private-provider-marker',env.JARVIS_SCHEDULER_TOKEN,'private-topic-marker','private-keyword-marker'])assert.ok(!text.includes(secret));db.db.close();
});
test('fresh and partially upgraded databases are reported without automatic schema creation or repair',async()=>{
 const db=testDB(),before=snapshot(db);const r=await inspectPreflight(config(readonly(db)),now);assert.equal(r.database.state,'incomplete');assert.equal(r.database.tables.find(t=>t.name==='business_records').state,'missing');assert.equal(r.ai.state,'ledger_unavailable');assert.deepEqual(snapshot(db),before);
 db.db.exec('CREATE TABLE business_records(id TEXT PRIMARY KEY)');const partial=await inspectPreflight(config(readonly(db)),now);assert.equal(partial.database.tables.find(t=>t.name==='business_records').state,'incompatible_columns');assert.equal(partial.collection.state,'disabled');db.db.close();
});
test('collection dry run distinguishes eligible, idle, token, global stop, active work and UTC daily limits',async()=>{
 const db=setup(),env={...config(readonly(db)),COLLECTION_AUTOMATION_ENABLED:'true'};assert.equal((await inspectPreflight(env,now)).collection.state,'idle');schedule(db);
 let r=await inspectPreflight(env,now);assert.equal(r.collection.state,'eligible_snapshot');assert.equal(r.productionReady,false);
 for(const token of ['short',env.JARVIS_ACCESS_PASSWORD]){r=await inspectPreflight({...env,JARVIS_SCHEDULER_TOKEN:token},now);assert.equal(r.collection.state,'blocked');assert.ok(r.collection.reasons.includes('dedicated_token_missing'));}
 assert.equal((await inspectPreflight({...env,COLLECTION_AUTOMATION_ENABLED:'false'},now)).collection.state,'disabled');
 collectionRun(db,{expires:now+10000});r=await inspectPreflight(env,now);assert.ok(r.collection.reasons.includes('already_running'));
 db.db.prepare("UPDATE collection_runs SET expires_at=?").run(now-1);r=await inspectPreflight({...env,COLLECTION_DAILY_LIMIT:'1'},now);assert.ok(r.collection.reasons.includes('daily_limit'));assert.equal(r.collection.snapshot.running,0);assert.equal(db.db.prepare('SELECT state FROM collection_runs').get().state,'running');db.db.close();
});
test('collection dry run refuses a full inbox and never reads article payloads',async()=>{
 const db=setup();schedule(db);const insert=db.db.prepare("INSERT INTO research_inbox VALUES(?,?,?,?,?,?,'new',?)");for(let i=0;i<500;i++)insert.run('id'+i,'digital','https://www.digital.go.jp/'+i,'hash'+i,'private-article-marker','run',now);
 const r=await inspectPreflight({...config(readonly(db)),COLLECTION_AUTOMATION_ENABLED:'true'},now);assert.ok(r.collection.reasons.includes('inbox_capacity'));assert.equal(r.collection.state,'blocked');assert.ok(!JSON.stringify(r).includes('private-article-marker'));db.db.close();
});
test('AI inspection uses runtime validation and blocks budget exhaustion, old uncertain spend and overruns without calling AI',async()=>{
 const db=setup(),env=config(readonly(db));assert.equal((await inspectPreflight(env,now)).ai.state,'configured_unverified');
 for(const patch of [{AI_MONTHLY_BUDGET_USD:'0'},{AI_PRICING_JSON:'invalid'},{ANTHROPIC_API_KEY:undefined},{AI_PROVIDER:'unknown'}])assert.equal((await inspectPreflight({...env,...patch},now)).ai.state,'unconfigured');
 run(db,{charged:100000000,state:'completed'});let r=await inspectPreflight(env,now);assert.equal(r.ai.state,'blocked');assert.equal(r.ai.remainingMicroUSD,0);
 db.db.prepare('DELETE FROM ai_operations').run();run(db,{charged:100,state:'uncertain',month:'2026-10'});r=await inspectPreflight(env,now);assert.equal(r.ai.state,'blocked');assert.equal(r.ai.blockingOperations,1);
 db.db.prepare("UPDATE ai_operations SET month='2026-11',state='overrun'").run();assert.equal((await inspectPreflight(env,now)).ai.state,'blocked');db.db.close();
});
test('opening balances and explicit environment uncertainty are retained without trusting user-supplied query flags',async()=>{
 const db=setup(),env=config(readonly(db));let r=await inspectPreflight({...env,AI_OPENING_SPEND_USD_JSON:'{"2026-11":"100"}'},now);assert.equal(r.ai.state,'blocked');
 for(const branch of [undefined,'main','backup-before-business-rebuild-2026-11-09']){r=await inspectPreflight({...env,CF_PAGES_BRANCH:branch},now);assert.notEqual(r.environment.state,'development_branch');assert.equal(r.productionReady,false);}db.db.close();
});
test('authentication rejects requests before any database query and responses never cache or leak storage errors',async()=>{
 const trap={prepare(){throw Error('private-storage-error');}};for(const env of [{JARVIS_DB:trap,JARVIS_ACCESS_PASSWORD:'secret'},{JARVIS_DB:trap}]){const response=await onRequestGet({request:new Request('http://localhost/api/business/preflight'),env});assert.ok([401,503].includes(response.status));assert.ok(!JSON.stringify(await response.json()).includes('private-storage-error'));}
 const db=setup(),env=config(readonly(db));let response=await onRequestGet({request:new Request('http://localhost/api/business/preflight?productionReady=true',{headers:{'x-jarvis-password':env.JARVIS_ACCESS_PASSWORD}}),env});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).productionReady,false);
 const error=await inspectPreflight({...config(trap)},now);assert.equal(error.database.state,'unavailable');assert.equal(error.ai.state,'ledger_unavailable');assert.ok(!JSON.stringify(error).includes('private-storage-error'));db.db.close();
});
test('a failed ledger read is not reported as a zero balance or a successful AI check',async()=>{
 const db=setup(),base=readonly(db),wrapper={prepare(sql){if(sql.includes('FROM ai_operations'))throw Error('private-ledger-error');return base.prepare(sql);}};
 const r=await inspectPreflight(config(wrapper),now);assert.equal(r.ai.state,'unavailable');assert.equal(r.ai.remainingMicroUSD,undefined);assert.ok(!JSON.stringify(r).includes('private-ledger-error'));db.db.close();
});
