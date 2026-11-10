import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB,budgetEnv} from './runtime-fixture.js';
import * as editorial from '../functions/api/business/editorial.js';
import * as jobs from '../functions/api/business/jobs.js';
import * as paid from '../functions/api/business/paid-drafts.js';
import * as drafts from '../functions/api/business/drafts.js';
import {latestDocument,saveRevision} from '../lib/documents.js';
import {editorialReport,defaultOutline,REVIEW_CHECKS,storedGenerationOptions} from '../lib/editorial.js';
import {generationOptions,generationPrompt,composeResult} from '../lib/generation.js';
import {article,evidence} from './paid-fixture.js';
const env=db=>({...budgetEnv,JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',ANTHROPIC_API_KEY:'fake'});
const req=b=>new Request('http://localhost/api',{method:'POST',headers:{'x-jarvis-password':'test','content-type':'application/json'},body:JSON.stringify(b)});
const get=url=>new Request('http://localhost/api'+url,{headers:{'x-jarvis-password':'test'}});
const data=(overrides={})=>({action:'save',projectId:'note-case',expectedRevision:0,topic:'業務整理ガイド',audience:'初めて業務を整理する人',notes:'事実と仮説を分ける',format:'note有料記事',text:article,evidence,workflow:{idea:'業務の抜けを減らすための実践手順と記入例を渡す',outline:defaultOutline('note有料記事'),noExternalFacts:false},manualComplete:true,...overrides});
const checks=Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]));
const post=(db,b)=>editorial.onRequestPost({request:req(b),env:env(db)});
async function offline(fn){const original=fetch;globalThis.fetch=()=>{throw Error('No real API allowed');};try{return await fn();}finally{globalThis.fetch=original;}}
test('planning saves sources, idea, outline and brief together without generating a fake article',async()=>offline(async()=>{
 const db=testDB();const r=await post(db,data({text:'',manualComplete:false}));assert.equal(r.status,201);const d=await r.json();assert.equal(d.report.stage,'planning');assert.equal(d.report.approved,false);assert.equal(d.document.evidence,evidence);assert.equal(d.document.workflow.outline.length,5);
 assert.equal((await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks})).status,409);
 assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='ai_usage'").get().n,0);db.db.close();
}));
test('paid article completes review and exports separate free and paid text with no publication',async()=>offline(async()=>{
 const db=testDB();let r=await post(db,data());assert.equal(r.status,201);assert.equal((await r.json()).report.stage,'review_pending');
 r=await post(db,{action:'export',projectId:'note-case',expectedRevision:1});assert.equal(r.status,409);
 r=await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks:{facts:true}});assert.equal(r.status,400);
 r=await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks});assert.equal(r.status,200);assert.equal((await r.json()).report.stage,'approved');
 r=await post(db,{action:'export',projectId:'note-case',expectedRevision:1});assert.equal(r.status,200);const d=await r.json();assert.match(d.freeMarkdown,/無料部分/);assert.doesNotMatch(d.freeMarkdown,/### 実践手順/);assert.match(d.paidMarkdown,/完成テンプレート/);assert.match(d.markdown,/参考資料/);assert.doesNotMatch(d.markdown,/管理データから作成した出典一覧|形式上の欠落検査/);assert.equal(d.revision,1);db.db.close();
}));
test('any new version loses editorial approval; the old local approved flag never grants export',async()=>offline(async()=>{
 const db=testDB();await post(db,data());await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks});
 let r=await post(db,data({expectedRevision:1,text:article+'\n追記しました。',approved:true,stage:'approved'}));assert.equal(r.status,201);assert.equal((await r.json()).report.approved,false);
 assert.equal((await post(db,{action:'export',projectId:'note-case',expectedRevision:2})).status,409);
 assert.equal((await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks})).status,409);
 assert.equal(db.db.prepare('SELECT COUNT(*) n FROM editorial_reviews').get().n,1);assert.equal((await latestDocument(db,'note-case')).revision,2);db.db.close();
}));
test('simultaneous stale saves have one winner and keep the earlier full draft',async()=>offline(async()=>{
 const db=testDB();await post(db,data());const rs=await Promise.all([post(db,data({expectedRevision:1,notes:'A'})),post(db,data({expectedRevision:1,notes:'B'}))]);assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM document_revisions WHERE project_id='note-case'").get().n,2);db.db.close();
}));
test('approval guards against a revision saved after reading but before confirming',async()=>offline(async()=>{
 const db=testDB();await post(db,data());let interleaved=false;
 const adapter={...db,prepare(sql){const stmt=db.prepare(sql);if(sql.startsWith('INSERT OR IGNORE INTO editorial_reviews')){const run=stmt.run.bind(stmt);stmt.run=async()=>{if(!interleaved){interleaved=true;const old=await latestDocument(db,'note-case');await saveRevision(db,'note-case',1,{...old,notes:'別タブ変更'});}return run();};}return stmt;}};
 const r=await editorial.onRequestPost({env:env(adapter),request:req({action:'approve',projectId:'note-case',expectedRevision:1,checks})});assert.equal(r.status,409);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM editorial_reviews').get().n,0);db.db.close();
}));
test('free notes require planned chapters and explicit completion and cannot hide unknown citations',async()=>offline(async()=>{
 const db=testDB(),b=data({format:'note無料記事',text:'# ガイド\n## 悩み\n困りごとを整理。\n## 解決\n手順を考える。',evidence:'',workflow:{idea:'体験からの考察',outline:['悩み','解決'],noExternalFacts:true}});
 const r=await post(db,b);assert.equal(r.status,201);assert.equal((await r.json()).report.readyForReview,true);
 const old=await latestDocument(db,'note-case');assert.equal(editorialReport({...old,output:old.output+' [R99]'}).readyForReview,false);
 assert.equal(editorialReport({...old,generation:{articleStatus:'unknown'}}).readyForReview,false);
 assert.equal(editorialReport({...old,output:'# ガイド\n## 悩み\n本文'}).chapters[1].status,'missing');db.db.close();
}));
test('incomplete paid artifacts remain deficiencies and cannot be approved by forged status flags',async()=>offline(async()=>{
 const db=testDB();const r=await post(db,data({text:article.replace('出力例：業務は会議資料整理、担当者はA、確認頻度は週1回。実在の実績ではありません。','出力例：未取得'),generation:{completionStatus:'complete',articleStatus:'manual_complete',project:{missing:[],humanReview:{status:'approved'}}}}));
 assert.equal(r.status,201);const d=await r.json();assert.equal(d.report.readyForReview,false);assert.equal(d.report.chapters.find(c=>c.title.startsWith('記入済み')).status,'needs_work');assert.equal((await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks})).status,409);db.db.close();
}));
test('saved long free chapters resume in place without resending or truncating the other chapters',async()=>{
 const db=testDB(),original=fetch;let calls=0,requestBody;
 const before='# 長文\n## 前半\n'+'前半の説明。'.repeat(6000)+'\n## 実践手順\n途中の手順はここです。\n\n## まとめ\n後続のまとめは維持します。';
 const b=data({format:'note無料記事',text:before,evidence:'',workflow:{idea:'長文を章ごとに制作',outline:['前半','実践手順','まとめ'],noExternalFacts:true}});
 assert.equal((await post(db,b)).status,201);
 globalThis.fetch=async(_url,init)=>{calls++;requestBody=JSON.parse(init.body);return Response.json({stop_reason:'max_tokens',usage:{input_tokens:100,output_tokens:20},content:[{type:'text',text:'追加の操作を一つずつ進めてください。'}]});};
 try{
  const r=await jobs.onRequestPost({env:env(db),request:req({department:'content',projectId:'note-case',expectedRevision:1,useSavedDraft:true,topic:b.topic,audience:b.audience,notes:b.notes,format:b.format,context:'',generation:{mode:'continue',section:'実践手順',previous:''}})});assert.equal(r.status,201);const d=await r.json();assert.equal(d.generation.document.revision,2);assert.equal(d.workflow.idea,b.workflow.idea);assert.equal(calls,1);assert.equal(requestBody.max_tokens,2500);assert.ok(requestBody.messages[0].content.length<20000);assert.match(requestBody.messages[0].content,/途中の手順はここです/);assert.doesNotMatch(requestBody.messages[0].content,/後続のまとめは維持/);
  assert.ok(d.output.startsWith('# 長文\n## 前半\n'+'前半の説明。'.repeat(6000)));assert.ok(d.output.indexOf('追加の操作')<d.output.indexOf('## まとめ'));assert.ok(d.output.endsWith('後続のまとめは維持します。'));assert.equal(d.generation.articleStatus,'incomplete');
  const saved=await latestDocument(db,'note-case');assert.equal(saved.workflow.outline.length,3);assert.equal(saved.output,d.output);
 }finally{globalThis.fetch=original;db.db.close();}
});
test('stale or mismatched saved conditions stop before quota reservation or a model call',async()=>offline(async()=>{
 const db=testDB();await post(db,data());
 const r=await jobs.onRequestPost({env:env(db),request:req({department:'content',projectId:'note-case',expectedRevision:1,useSavedDraft:true,topic:'変更テーマ',audience:'',notes:'',format:'note有料記事',context:evidence,generation:{mode:'continue',section:'実践手順'}})});assert.equal(r.status,409);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='ai_usage'").get().n,0);db.db.close();
}));
test('free chapter generation rejects duplicates and does not replace later sections',()=>{
 const original='# タイトル\n## 最初\n既存本文。\n## 空の章\n\n## 最後\n最後は保持。';
 const o=generationOptions({mode:'chapter',format:'note無料記事',section:'空の章',previous:original,title:'タイトル'});
 const r=composeResult({text:'## 空の章\n追加の本文。',generation:{completionStatus:'complete'}},o);assert.match(r.body,/## 空の章\n追加の本文/);assert.ok(r.body.endsWith('最後は保持。'));assert.equal((r.body.match(/## 空の章/g)||[]).length,1);
 assert.throws(()=>generationPrompt('x',{...o,section:'最初'}),e=>e.code==='INVALID_CONTINUATION');
 assert.throws(()=>composeResult({text:'## 最初\n逆戻り',generation:{}},o),e=>e.code==='INVALID_CONTINUATION');
 assert.throws(()=>generationOptions({mode:'continue',previous:'a'.repeat(30001)}));
 assert.throws(()=>storedGenerationOptions({mode:'continue'},{department:'content',format:'note無料記事',output:'x'.repeat(60001)}));
});
test('existing saves keep editorial metadata and legacy paid lists return the latest body with the correct version',async()=>offline(async()=>{
 const db=testDB();await post(db,data());const old=await latestDocument(db,'note-case');await saveRevision(db,'note-case',1,{...old,output:old.output+'\n新版'});
 let r=await paid.onRequestGet({env:env(db),request:get('')});const list=(await r.json()).drafts;assert.ok(list[0].output.endsWith('新版'));assert.equal(list[0].generation.document.revision,2);
 r=await paid.onRequestPost({env:env(db),request:req({id:'note-case',expectedRevision:2,topic:old.topic,text:old.output,evidence:old.evidence,generation:old.generation,manualComplete:true})});assert.equal(r.status,201);assert.equal((await latestDocument(db,'note-case')).workflow.idea,old.workflow.idea);db.db.close();
}));
test('review queue includes stages, reopens complete snapshots and paginates without losing older projects',async()=>offline(async()=>{
 const db=testDB();for(let i=0;i<52;i++){const r=await post(db,data({projectId:'queue-'+i,text:'',manualComplete:false}));assert.equal(r.status,201);}
 let r=await editorial.onRequestGet({env:env(db),request:get('')});let page=await r.json();assert.equal(page.projects.length,50);assert.ok(page.nextCursor);r=await editorial.onRequestGet({env:env(db),request:get('?before='+page.nextCursor)});page=await r.json();assert.equal(page.projects.length,2);assert.equal(page.nextCursor,null);
 r=await editorial.onRequestGet({env:env(db),request:get('?projectId=queue-0')});const d=await r.json();assert.equal(d.document.workflow.idea,data().workflow.idea);assert.equal(d.report.stage,'planning');db.db.close();
}));
test('malformed workflow and unauthenticated requests cannot create reviews or spend',async()=>offline(async()=>{
 const db=testDB();for(const method of ['onRequestGet','onRequestPost']){const r=await editorial[method]({env:env(db),request:new Request('http://localhost/api')});assert.equal(r.status,401);}
 assert.equal((await post(db,data({workflow:{idea:'x',outline:['重複','重複']}}))).status,400);
 assert.equal((await post(db,data({workflow:{idea:'x',outline:['違う構成','終わり']}}))).status,400);
 assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='ai_usage'").get().n,0);db.db.close();
}));
test('long paid chapter continuation preserves later paid artifacts and the saved source snapshot',async()=>{
 const db=testDB(),original=fetch;const long=article.replace('対象は初心者。','長い導入文です。'.repeat(4500)).replace('確認：抜けや個人情報がないか確認してください。','確認：抜けを確認する途中です。');
 const b=data({text:long,manualComplete:false,generation:{completionStatus:'incomplete',stopReason:'max_tokens'}});assert.equal((await post(db,b)).status,201);let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;const prompt=JSON.parse(init.body).messages[0].content;assert.match(prompt,/確認する途中/);assert.ok(prompt.length<20000);return Response.json({stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:20},content:[{type:'text',text:'最後に記入した項目を担当者ともう一度照合します。'}]});};
 try{
  const r=await jobs.onRequestPost({env:env(db),request:req({department:'content',projectId:'note-case',expectedRevision:1,useSavedDraft:true,topic:b.topic,audience:b.audience,notes:b.notes,format:b.format,context:b.evidence,generation:{mode:'continue',section:'実践手順',previous:''}})});assert.equal(r.status,201);const d=await r.json();assert.equal(calls,1);assert.ok(d.output.indexOf('最後に記入')<d.output.indexOf('### 記入済みサンプル'));assert.match(d.output,/業務名：\[業務名\]/);assert.equal(d.generation.project.evidence,evidence);assert.equal(d.generation.document.revision,2);
 }finally{globalThis.fetch=original;db.db.close();}
});
test('legacy free-note save cannot drop workflow or reuse the old editorial approval',async()=>offline(async()=>{
 const db=testDB(),b=data({format:'note無料記事',text:'# 考察\n## 悩み\n整理。\n## 対策\n解決。',evidence:'',workflow:{idea:'考察を共有',outline:['悩み','対策'],noExternalFacts:true}});await post(db,b);await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks});
 const r=await drafts.onRequestPost({env:env(db),request:req({projectId:'note-case',expectedRevision:1,department:'content',topic:b.topic,format:b.format,text:b.text+'\n修正',evidence:'',generation:{articleStatus:'manual_complete'}})});assert.equal(r.status,201);const latest=await latestDocument(db,'note-case');assert.equal(latest.workflow.idea,b.workflow.idea);assert.equal(latest.audience,b.audience);assert.equal((await post(db,{action:'export',projectId:'note-case',expectedRevision:2})).status,409);db.db.close();
}));
test('paid export boundary ignores an example heading inside a fenced code block',async()=>offline(async()=>{
 const db=testDB();const text=article.replace('## 有料部分','```md\n## 有料部分\nこれは無料部分の中の見出し例です。\n```\n\n## 有料部分');await post(db,data({text}));assert.equal((await post(db,{action:'approve',projectId:'note-case',expectedRevision:1,checks})).status,200);const r=await post(db,{action:'export',projectId:'note-case',expectedRevision:1});const d=await r.json();assert.match(d.freeMarkdown,/これは無料部分の中/);assert.doesNotMatch(d.freeMarkdown,/### 実践手順/);assert.ok(d.paidMarkdown.startsWith('## 有料部分\n'));db.db.close();
}));
test('the first free-note chapter retains the requested title and planned order is checked',()=>{
 const o=generationOptions({mode:'chapter',format:'note無料記事',section:'悩み',previous:'',title:'役立つ記事'});
 const r=composeResult({text:'読者の困りごと。',generation:{completionStatus:'complete'}},o);assert.ok(r.body.startsWith('# 役立つ記事'));assert.match(r.body,/## 悩み/);
 const report=editorialReport({topic:'記事',audience:'読者',format:'note無料記事',evidence:'',output:'# 記事\n## 二章\n本文\n## 一章\n本文',generation:{articleStatus:'manual_complete'},workflow:{idea:'順番',outline:['一章','二章'],noExternalFacts:true}});assert.ok(report.missing.some(x=>x.includes('章順')));
});
test('optional review migration matches the runtime table without altering existing tables',async()=>offline(async()=>{
 const {readFileSync}=await import('node:fs');const a=testDB(),b=testDB();await editorial.onRequestGet({env:env(a),request:get('')});b.db.exec(readFileSync(new URL('../migrations/0006_editorial_reviews.sql',import.meta.url),'utf8'));assert.deepEqual(a.db.prepare('PRAGMA table_info(editorial_reviews)').all(),b.db.prepare('PRAGMA table_info(editorial_reviews)').all());assert.deepEqual(a.db.prepare('PRAGMA table_info(business_jobs)').all(),b.db.prepare('PRAGMA table_info(business_jobs)').all());a.db.close();b.db.close();
}));
