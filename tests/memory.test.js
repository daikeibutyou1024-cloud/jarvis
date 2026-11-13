import test from 'node:test';import assert from 'node:assert/strict';
import {testDB} from './runtime-fixture.js';import {saveRevision} from '../lib/documents.js';
import {MEMORY_SCHEMA,saveMemory,memoryList,memoryContext,findWork} from '../lib/memory.js';
import * as api from '../functions/api/business/memory.js';
const now=Date.parse('2026-11-13T12:00:00+09:00');
const req=(body,password='test')=>new Request('http://localhost/api/business/memory',{method:body?'POST':'GET',headers:{'x-jarvis-password':password},...(body?{body:JSON.stringify(body)}:{})});
const env=db=>({JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',JARVIS_MEMORY_ENABLED:'true',ANTHROPIC_API_KEY:'sk-ant-secret-test-value'});
test('authentication and disabled/unprepared gates do not initialize or write memory',async()=>{const db=testDB();try{
 assert.equal((await api.onRequestGet({env:env(db),request:req(null,'bad')})).status,401);assert.equal((await api.onRequestPost({env:env(db),request:req({action:'save',kind:'goal',text:'無許可',confirmed:true},'bad')})).status,401);
 assert.equal((await api.onRequestGet({env:{...env(db),JARVIS_MEMORY_ENABLED:'false'},request:req()})).status,503);
 assert.equal((await api.onRequestGet({env:env(db),request:req()})).status,503);
 assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='jarvis_memories'").get().n,0);
}finally{db.db.close();}});
test('history reload and confirmed notes context, edit conflict and delete protect articles',async()=>{const db=testDB();db.db.exec(MEMORY_SCHEMA);try{
 await saveRevision(db,'existing-case',0,{topic:'既存記事',output:'保持'});
 const h=await saveMemory(db,{kind:'history',user:'目標を相談',assistant:'未検証の回答'},env(db),now);
 const n=await saveMemory(db,{kind:'goal',text:'note教材を作る',confirmed:false},env(db),now);
 assert(!memoryContext(await memoryList(db,now),'note').includes('note教材'));
 await saveMemory(db,{id:n.id,expectedVersion:1,kind:'goal',text:'note教材を作る',confirmed:true},env(db),now);
 assert(memoryContext(await memoryList(db,now),'note').includes('note教材'));assert(memoryContext(await memoryList(db,now),'note').length<=1400);
 await assert.rejects(saveMemory(db,{id:n.id,expectedVersion:1,kind:'goal',text:'古い上書き',confirmed:true},env(db),now));
 const res=await api.onRequestPost({env:env(db),request:req({action:'delete',id:n.id,expectedVersion:2})});assert.equal(res.status,200);
 assert.equal(db.db.prepare('SELECT payload FROM document_revisions').get().payload.includes('保持'),true);assert.equal((await memoryList(db,now)).find(x=>x.id===h.id).confirmed,false);
}finally{db.db.close();}});
test('known passwords including JSON escapes, API keys, tokens and credential assignments are rejected',async()=>{const db=testDB();db.db.exec(MEMORY_SCHEMA);try{
 for(const text of ['sk-ant-secret-test-value','Bearer abc','password=abc','APIキー：abc','private"quoted'])await assert.rejects(saveMemory(db,{kind:'rule',text,confirmed:true},{...env(db),JARVIS_ACCESS_PASSWORD:'private"quoted'},now));
 assert.equal((await memoryList(db,now)).length,0);
}finally{db.db.close();}});
test('retention and row/byte limits stop saving instead of evicting active records',async()=>{const db=testDB();db.db.exec(MEMORY_SCHEMA);try{
 for(let i=0;i<30;i++)await saveMemory(db,{kind:'preference',text:'方針'+i,confirmed:true},env(db),now);
 await assert.rejects(saveMemory(db,{kind:'goal',text:'上限',confirmed:true},env(db),now));
 await saveMemory(db,{kind:'history',user:'相談',assistant:'回答'},env(db),now);assert.equal((await memoryList(db,now+31*86400000)).filter(x=>x.kind==='history').length,0);assert.equal((await memoryList(db,now+181*86400000)).length,0);
 const big='あ'.repeat(8000);for(let i=0;i<10;i++){try{await saveMemory(db,{kind:'history',user:'相談'+i,assistant:big},env(db),now);}catch{break;}}
 assert(db.db.prepare('SELECT SUM(bytes) n FROM jarvis_memories').get().n<=262144);
}finally{db.db.close();}});
test('yesterday work uses JST, preserves ambiguity, and never invents a missing article',async()=>{const db=testDB();try{
 for(const id of ['one','two','today']){await saveRevision(db,id,0,{topic:id,format:'note無料記事',output:'原稿'});db.db.prepare('UPDATE document_revisions SET created_at=? WHERE project_id=?').run(id==='today'?'2026-11-13 03:00:00':'2026-11-12 03:00:00',id);}
 const rows=await findWork(db,'昨日の記事の続きを',env(db),now);assert.deepEqual(rows.map(x=>x.title).sort(),['one','two']);assert(!JSON.stringify(rows).includes('原稿'));assert.equal((await findWork(db,'昨日の記事',env(db),now+5*86400000)).length,0);
}finally{db.db.close();}});
