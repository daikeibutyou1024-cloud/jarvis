import {createPack} from './quick-draft.js';
import {reviseMock} from './internal-jobs.js';
import {socialDrafts} from './marketing-preview.js';
import {executeAutonomousJob} from './autonomous-engine.js';
export const PREVIEW_DB_ID='5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0';
const enc=new TextEncoder();
export const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
export function fault(message,status=400){const e=Error(message);e.status=status;return e;}
export function identifier(id){if(typeof id!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(id))throw fault('案件ID・リクエストIDが不正です');return id;}
// Owner scope is server-derived; neither request payload nor a browser chooses its tenant.
// Existing authentication has one administrator, not multiple user accounts. Password rotation
// changes this scope; recovery/reassignment must be separately reviewed, never automatic.
export const ownerScope=env=>hash('jarvis-cloud-owner-v1:'+env.JARVIS_ACCESS_PASSWORD);
export function rejectSecrets(value,env){const text=JSON.stringify(value);if(/\b(?:sk-(?:ant-)?[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9_.-]{16,})/.test(text)||Object.keys(env).filter(k=>/PASSWORD|SECRET|TOKEN|API_KEY/.test(k)).some(k=>typeof env[k]==='string'&&env[k].length>=6&&text.includes(env[k])))throw fault('秘密情報を含む内容は保存できません');}
export function cloudStore(db,owner,{now=()=>Date.now()}={}){
 const stmt=(q,...args)=>db.prepare(q).bind(...args),first=(q,...a)=>stmt(q,...a).first(),all=async(q,...a)=>(await stmt(q,...a).all()).results;
 const at=()=>new Date(now()).toISOString(),day=()=>new Date(now()+9*3600000).toISOString().slice(0,10);
 let lease=null;
 const guard=()=>({sql:"EXISTS(SELECT 1 FROM autonomous_jobs WHERE owner_id=? AND job_id='__runner__' AND lease_owner=? AND fence=? AND lease_until>?)",args:[owner,lease?.token||'',lease?.fence||0,now()]});
 async function binding(){const row=await first("SELECT report_json FROM autonomous_reports WHERE owner_id='__binding__' AND report_day='jarvis-preview'");if(!row||JSON.parse(row.report_json).databaseId!==PREVIEW_DB_ID)throw fault('Preview専用DBの確認に失敗しました。保存を停止しました',503);}
 async function snapshot(){const packs=await all('SELECT d.pack_json FROM autonomous_documents d JOIN autonomous_projects p ON p.owner_id=d.owner_id AND p.project_id=d.project_id AND p.revision=d.revision WHERE d.owner_id=? ORDER BY p.updated_at DESC LIMIT 100',owner);return {packs:packs.map(r=>JSON.parse(r.pack_json)),jobs:(await all("SELECT data_json FROM autonomous_jobs WHERE owner_id=? AND job_id!='__runner__' ORDER BY updated_at DESC LIMIT 100",owner)).map(r=>JSON.parse(r.data_json)),reports:(await all('SELECT report_day,report_json FROM autonomous_reports WHERE owner_id=? ORDER BY report_day DESC LIMIT 31',owner)).map(r=>({day:r.report_day,...JSON.parse(r.report_json)})),limit:100};}
 async function history(id){identifier(id);return all('SELECT revision,action,instruction,content_hash,created_at FROM autonomous_reviews WHERE owner_id=? AND project_id=? ORDER BY revision DESC LIMIT 100',owner,id);}
 async function version(id,revision){identifier(id);if(!Number.isSafeInteger(revision)||revision<1||revision>100)throw fault('版番号が不正です');const r=await first('SELECT pack_json FROM autonomous_documents WHERE owner_id=? AND project_id=? AND revision=?',owner,id,revision);if(!r)throw fault('対象版が見つかりません',404);return JSON.parse(r.pack_json);}
 async function exclusive(fn){
  const allowance=await first('SELECT request_count FROM autonomous_reports WHERE owner_id=? AND report_day=?',owner,day());if(allowance?.request_count>=100)throw fault('1日の保存・実行上限に達しました',429);
  const token=crypto.randomUUID(),t=now();
  // One owner-wide lease serializes source dedup, saves and jobs. No polling/heartbeat worker.
  const claim=await stmt("INSERT INTO autonomous_jobs(owner_id,job_id,lease_owner,lease_until,fence,updated_at) VALUES(?,'__runner__',?,?,1,?) ON CONFLICT(owner_id,job_id) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until,fence=autonomous_jobs.fence+1,updated_at=excluded.updated_at WHERE autonomous_jobs.lease_until<=?",owner,token,t+60000,at(),t).run();
  if(!claim.meta.changes)throw fault('別の処理が実行中です。完了後に再試行してください',409);
  const row=await first("SELECT fence FROM autonomous_jobs WHERE owner_id=? AND job_id='__runner__' AND lease_owner=?",owner,token);lease={token,fence:row.fence};
  try{
   const count=await stmt('INSERT INTO autonomous_reports(owner_id,report_day,request_count,updated_at) VALUES(?,?,1,?) ON CONFLICT(owner_id,report_day) DO UPDATE SET request_count=request_count+1,updated_at=excluded.updated_at WHERE request_count<100',owner,day(),at()).run();
   if(!count.meta.changes)throw fault('1日の保存・実行上限に達しました。自動再送せず停止します',429);
   return await fn(true);
  }finally{await stmt("UPDATE autonomous_jobs SET lease_owner=NULL,lease_until=0 WHERE owner_id=? AND job_id='__runner__' AND lease_owner=? AND fence=?",owner,token,lease.fence).run();lease=null;}
 }
 async function updateJob(id,patch){identifier(id);const g=guard(),old=await first('SELECT data_json FROM autonomous_jobs WHERE owner_id=? AND job_id=?',owner,id);const data={...(old?JSON.parse(old.data_json):{id,createdAt:at()}),...patch,updatedAt:at()};const result=await stmt(`INSERT INTO autonomous_jobs(owner_id,job_id,data_json,updated_at) SELECT ?,?,?,? WHERE ${g.sql} AND ((SELECT COUNT(*) FROM autonomous_jobs)<1000 OR EXISTS(SELECT 1 FROM autonomous_jobs WHERE owner_id=? AND job_id=?)) ON CONFLICT(owner_id,job_id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`,owner,id,JSON.stringify(data),at(),...g.args,owner,id).run();if(!result.meta.changes)throw fault('ジョブ保存上限または実行権限を確認できません。保存結果を再取得してください',409);return data;}
 async function getPack(id){const row=await first('SELECT d.pack_json FROM autonomous_documents d JOIN autonomous_projects p ON p.owner_id=d.owner_id AND p.project_id=d.project_id AND p.revision=d.revision WHERE d.owner_id=? AND d.project_id=?',owner,id);return row?JSON.parse(row.pack_json):null;}
 async function findSource(s){const key=await hash(s.sourceUrl+'\n'+s.publishedAt);const p=await first('SELECT project_id FROM autonomous_projects WHERE owner_id=? AND source_key=?',owner,key);return p?getPack(p.project_id):null;}
 async function put(pack,expected,{mutationId=crypto.randomUUID(),requestHash='engine',action='created',instruction=''}={}){
  identifier(pack.projectId);identifier(mutationId);if(!Number.isSafeInteger(expected)||expected<0||expected>=100)throw fault('原稿版数の上限または形式を確認してください');
  const old=await first('SELECT pack_json,request_hash FROM autonomous_documents WHERE owner_id=? AND mutation_id=?',owner,mutationId);if(old){if(old.request_hash!==requestHash)throw fault('同じ操作IDの内容が異なります',409);return JSON.parse(old.pack_json);}
  const next={...pack,revision:expected+1,savedAt:at(),storage:'cloud'},payload=JSON.stringify(next);
  if(enc.encode(payload).length>240000)throw fault('保存サイズ上限を超えています',413);
  const digest=await hash(payload),sourceHash=await hash(JSON.stringify(pack.source)),sourceKey=await hash(pack.source.sourceUrl+'\n'+pack.source.publishedAt),g=guard(),list=[];
  if(expected===0){
   list.push(stmt(`INSERT INTO autonomous_projects(owner_id,project_id,revision,state,source_key,created_at,updated_at) SELECT ?,?,0,'running',?,?,? WHERE ${g.sql} AND (SELECT COUNT(*) FROM autonomous_projects WHERE owner_id=?)<100 ON CONFLICT DO NOTHING`,owner,pack.projectId,sourceKey,pack.createdAt,at(),...g.args,owner));
  }
  list.push(stmt(`UPDATE autonomous_projects SET revision=?,state=?,last_write=?,updated_at=? WHERE owner_id=? AND project_id=? AND revision=? AND (SELECT COUNT(*) FROM autonomous_documents)<1000 AND ${g.sql}`,next.revision,next.jobState,mutationId,at(),owner,pack.projectId,expected,...g.args));
  const selected="SELECT 1 FROM autonomous_projects WHERE owner_id=? AND project_id=? AND last_write=? AND revision=?";const args=[owner,pack.projectId,mutationId,next.revision];
  list.push(stmt(`INSERT INTO autonomous_documents(owner_id,project_id,revision,pack_json,content_hash,mutation_id,request_hash,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${selected})`,owner,pack.projectId,next.revision,payload,digest,mutationId,requestHash,at(),...args));
  if(expected===0)list.push(stmt(`INSERT INTO autonomous_sources(owner_id,project_id,source_json,content_hash) SELECT ?,?,?,? WHERE EXISTS(${selected})`,owner,pack.projectId,JSON.stringify(pack.source),sourceHash,...args));
  list.push(stmt(`INSERT INTO autonomous_reviews(owner_id,project_id,revision,action,instruction,content_hash,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${selected})`,owner,pack.projectId,next.revision,action,instruction,digest,at(),...args));
  const result=await db.batch(list);if(!result[expected===0?1:0].meta.changes)throw fault('保存上限・版競合・実行権限を確認してください。編集を退避して再取得してください',409);
  return next;
 }
 async function report(){const g=guard();const counts=await first("SELECT COUNT(*) total,SUM(state='awaiting_approval') pending,SUM(state='revision_requested') revisions FROM autonomous_projects WHERE owner_id=?",owner);const failures=await first("SELECT COUNT(*) n FROM autonomous_jobs WHERE owner_id=? AND job_id!='__runner__' AND json_extract(data_json,'$.state')='failed'",owner);const summary={...counts,errors:failures.n,posting:'未接続・公開なし',finance:'端末の手入力分は未移行・API請求未確認',updatedAt:at()};const r=await stmt(`UPDATE autonomous_reports SET report_json=?,updated_at=? WHERE owner_id=? AND report_day=? AND ${g.sql}`,JSON.stringify(summary),at(),owner,day(),...g.args).run();if(!r.meta.changes)throw fault('業務報告の保存を確認できません',409);return summary;}
 async function run(id,collect){return executeAutonomousJob({id,ports:{exclusive:fn=>exclusive(async acquired=>{try{return await fn(acquired);}finally{await report();}}),jobs:{get:async id=>{const r=await first('SELECT data_json FROM autonomous_jobs WHERE owner_id=? AND job_id=?',owner,id);return r?JSON.parse(r.data_json):null;},update:updateJob},packs:{get:getPack,findSource,put},research:{collect},ai:{kind:'preview-mock',build:async(data,id)=>createPack(data,id)},records:{snapshot:async()=>({})},analysis:{summarize:report},notify:async()=>{}}});}
 async function edit(body){return exclusive(async()=>{
  const old=await getPack(identifier(body.id));if(!old)throw fault('クラウド案件が見つかりません。端末データの移行は行いません',404);
  const requestHash=await hash(JSON.stringify(body)),seen=await first('SELECT request_hash,pack_json FROM autonomous_documents WHERE owner_id=? AND mutation_id=?',owner,body.mutationId);
  if(seen){if(seen.request_hash!==requestHash)throw fault('同じ操作IDの内容が異なります',409);const saved=JSON.parse(seen.pack_json);if(old.revision===saved.revision)await updateJob(body.id,{state:saved.jobState});await report();return saved;}
  if(old.revision!==body.expectedRevision)throw fault('別の保存があります。編集を退避し、再取得してください',409);
  let next=structuredClone(old);const action=body.action,instruction=body.instruction||'';
  if(!['edit','approve','reject','revise'].includes(action))throw fault('操作が不正です');
  if(action==='approve'){
   const j=await first('SELECT data_json FROM autonomous_jobs WHERE owner_id=? AND job_id=?',owner,body.id),job=j&&JSON.parse(j.data_json);
   if(body.sourceChecked!==true||body.contentChecked!==true||old.jobState==='revision_requested'||['failed','running'].includes(job?.state)||!job?.stages?.includes('approval'))throw fault('業務完了と本人による出典・内容確認が必要です');
   next.approvedAt=at();next.source.reviewedAt=next.approvedAt;next.jobState='approved';
  }else{
   next.approvedAt=null;next.source.reviewedAt=null;next.jobState='awaiting_approval';
   if(action==='edit'){for(const [key,max] of [['article',60000],['x',2000],['instagram',5000]]){if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>max)throw fault('記事・SNS案の文字数を確認してください');next[key]=body[key];}}
   if(action==='revise'){next=reviseMock(next,instruction);if(next.jobState==='awaiting_approval'){const posts=socialDrafts({projectId:next.projectId,title:next.title,article:next.article,evidence:next.evidence,mock:true});next.x=posts.x;next.instagram=posts.instagram;}}
   if(action==='reject'){if(typeof instruction!=='string'||instruction.length>1000)throw fault('修正指示は1000文字以内です');next.jobState='rejected';next.revisionRequests=[...(next.revisionRequests||[]),{instruction:instruction||'本人が差し戻しました',at:at(),mode:'manual-reject'}];}
  }
  const saved=await put(next,body.expectedRevision,{mutationId:identifier(body.mutationId),requestHash,action,instruction});await updateJob(body.id,{state:saved.jobState});await report();return saved;
 });}
 return {binding,snapshot,history,version,exclusive,run,edit,getPack,put,updateJob,report,guard};
}
