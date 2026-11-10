import {japanDay} from './calendar.js';
export const BUSINESS_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS business_records (id TEXT PRIMARY KEY, version INTEGER NOT NULL, kind TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS idx_business_records_kind_project ON business_records(kind,project_id)`,
 `CREATE TABLE IF NOT EXISTS business_record_history (record_id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY(record_id,version))`,
 `CREATE TABLE IF NOT EXISTS business_imports (id TEXT PRIMARY KEY, result_json TEXT NOT NULL, recorded_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS business_write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1))`,
];
export class BusinessError extends Error{constructor(message,status=400,code='BUSINESS_INPUT'){super(message);this.status=status;this.code=code;}}
export async function initBusiness(db){for(const sql of BUSINESS_SCHEMA)await db.prepare(sql).run();}
export function text(value,max,name,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new BusinessError(name+'の形式・長さを確認してください');return value.trim();}
export function id(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(value))throw new BusinessError('記録IDが不正です');return value;}
export function project(value=''){if(value==='')return '';return id(value);}
export function period(value){if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new BusinessError('対象月はYYYY-MM形式です');return value;}
export function yenMinor(value){const s=String(value);if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s))throw new BusinessError('金額は0より大きい円の数値（小数2桁まで）です');const [whole,fraction='']=s.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0||n>99999999900)throw new BusinessError('金額の範囲を確認してください');return n;}
export const CHANNELS=['all','note','x','instagram','tiktok','affiliate','other','unspecified'];
export async function fingerprint(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function normalizeRecord(b){
 const projectId=project(b.projectId===undefined?'':b.projectId);
 if(b.kind==='finance'){
  if(b.currency!==undefined&&b.currency!=='JPY')throw new BusinessError('円以外の通貨は自動換算せず停止します');
  let date;try{date=japanDay(b.date).date;}catch{throw new BusinessError('実在する日付を指定してください');}
  if(!b.date||!['revenue','expense','api'].includes(b.type))throw new BusinessError('日付・収支区分を確認してください');
  const payload={kind:'finance',projectId,date,type:b.type,amountMinor:yenMinor(b.amount),currency:'JPY',memo:text(b.memo??'',500,'摘要'),source:'user_provided'};
  return {id:b.id?id(b.id):crypto.randomUUID(),kind:'finance',projectId,payload};
 }
 if(b.kind==='metrics'){
  const month=period(b.period),channel=b.channel||'unspecified';if(!CHANNELS.includes(channel))throw new BusinessError('計測元を確認してください');
  for(const key of ['visits','clicks','conversions'])if(!Number.isSafeInteger(b[key])||b[key]<0||b[key]>1000000000)throw new BusinessError('成果の各件数は0以上の整数です');
  if(b.clicks>b.visits||b.conversions>b.clicks)throw new BusinessError('クリック数・成果件数と母数の関係を確認してください');
  const recordId='metric-'+(await fingerprint(JSON.stringify([projectId,month,channel]))).slice(0,48);
  if(b.id&&b.id!==recordId)throw new BusinessError('計測の案件・月・計測元は別記録として保存してください');
  return {id:recordId,kind:'metrics',projectId,payload:{kind:'metrics',projectId,period:month,channel,visits:b.visits,clicks:b.clicks,conversions:b.conversions,source:'user_provided'}};
 }
 throw new BusinessError('記録の種類が不正です');
}
async function validateProject(db,projectId){
 if(!projectId)return;
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_revisions'").first();
 if(!exists||!await db.prepare('SELECT project_id FROM document_revisions WHERE project_id=? LIMIT 1').bind(projectId).first())throw new BusinessError('指定した制作案件が見つかりません');
}
async function validateProjects(db,ids){
 const selected=[...new Set(ids.filter(Boolean))];if(!selected.length)return;
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_revisions'").first();
 if(!exists)throw new BusinessError('指定した制作案件が見つかりません');
 const rows=(await db.prepare(`SELECT DISTINCT project_id FROM document_revisions WHERE project_id IN (${selected.map(()=>'?').join(',')})`).bind(...selected).all()).results;
 if(selected.some(p=>!rows.some(r=>r.project_id===p)))throw new BusinessError('指定した制作案件が見つかりません');
}
export async function currentRecord(db,recordId){await initBusiness(db);const row=await db.prepare('SELECT * FROM business_records WHERE id=?').bind(id(recordId)).first();return row?{...row,payload:JSON.parse(row.payload_json)}:null;}
function mutationStatements(db,record,version,state,now){
 return [
 db.prepare('INSERT INTO business_records(id,version,kind,project_id,payload_json,state,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,project_id=excluded.project_id,payload_json=excluded.payload_json,state=excluded.state,updated_at=excluded.updated_at').bind(record.id,version,record.kind,record.projectId,JSON.stringify(record.payload),state,now),
 db.prepare('INSERT INTO business_record_history(record_id,version,payload_json,state,recorded_at) VALUES(?,?,?,?,?)').bind(record.id,version,JSON.stringify(record.payload),state,now),
 ];
}
export async function saveBusinessRecord(db,record,expectedVersion,state='active',guard=null){
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!['active','void'].includes(state))throw new BusinessError('記録の版・状態が不正です');
 await initBusiness(db);await validateProject(db,record.projectId);
 const write=crypto.randomUUID(),now=Date.now();
 const condition=expectedVersion===0?'NOT EXISTS(SELECT 1 FROM business_records WHERE id=?) AND (SELECT COUNT(*) FROM business_records)<10000':'EXISTS(SELECT 1 FROM business_records WHERE id=? AND version=? AND kind=?)';
 const args=expectedVersion===0?[record.id]:[record.id,expectedVersion,record.kind];
 const statements=[db.prepare(`INSERT INTO business_write_guards(id,valid) SELECT ?,CASE WHEN (${condition}) ${guard?'AND ('+guard.sql+')':''} THEN 1 ELSE 0 END`).bind(write,...args,...(guard?.args||[])),...mutationStatements(db,record,expectedVersion+1,state,now),db.prepare('DELETE FROM business_write_guards WHERE id=?').bind(write)];
 try{await db.batch(statements);}catch{
  if(expectedVersion===0&&!guard){const old=await db.prepare('SELECT * FROM business_records WHERE id=?').bind(record.id).first();if(old&&old.kind===record.kind&&old.project_id===record.projectId&&old.payload_json===JSON.stringify(record.payload)&&old.state===state)return {id:record.id,version:old.version,state,alreadySaved:true};}
  throw new BusinessError('別の保存が完了したか、保存条件を満たしません。再取得してください',409,'BUSINESS_CONFLICT');
 }
 return {id:record.id,version:expectedVersion+1,state};
}
export async function importBusinessRecords(db,rawRows,source){
 if(!Array.isArray(rawRows)||!rawRows.length||rawRows.length>10||!['legacy','csv','copy'].includes(source))throw new BusinessError('コピーは1〜10件ずつ指定してください');
 const records=[];
 for(const b of rawRows){
  if(b.state!==undefined&&!["active","void"].includes(b.state))throw new BusinessError("コピーする記録の状態が不正です");
  const normalized=await normalizeRecord(b);
  if(b.kind==='finance'){
  if(b.currency!==undefined&&b.currency!=='JPY')throw new BusinessError('円以外の通貨は自動換算せず停止します');
   const externalId=text(b.externalId||b.id||'',100,'元の記録ID',true);
   normalized.id=source==='legacy'?'legacy-'+(await fingerprint('ledger/'+externalId)).slice(0,48):id(b.id||externalId);
  }
  records.push({...normalized,state:b.state==='void'?'void':'active'});
 }
 if(new Set(records.map(r=>r.id)).size!==records.length)throw new BusinessError('同じ記録が重複しています');
 records.sort((a,b)=>a.id.localeCompare(b.id));await initBusiness(db);
 const receiptId=await fingerprint(JSON.stringify(records));
 const receipt=await db.prepare('SELECT result_json FROM business_imports WHERE id=?').bind(receiptId).first();
 if(receipt)return {...JSON.parse(receipt.result_json),alreadyApplied:true};
 await validateProjects(db,records.map(r=>r.projectId));
 const existing=(await db.prepare(`SELECT * FROM business_records WHERE id IN (${records.map(()=>'?').join(',')})`).bind(...records.map(r=>r.id)).all()).results;
 for(const r of records){const old=existing.find(x=>x.id===r.id);if(old&&(old.kind!==r.kind||old.project_id!==r.projectId||old.payload_json!==JSON.stringify(r.payload)||old.state!==r.state))throw new BusinessError('同じIDの記録が既に異なる内容で保存されています。元データは変更せず停止しました',409,'BUSINESS_CONFLICT');}
 const fresh=records.filter(r=>!existing.some(x=>x.id===r.id));
 const conditions=['NOT EXISTS(SELECT 1 FROM business_imports WHERE id=?)','(SELECT COUNT(*) FROM business_records)+?<=10000'],params=[receiptId,fresh.length];
 for(const r of records){const old=existing.find(x=>x.id===r.id);conditions.push(old?'EXISTS(SELECT 1 FROM business_records WHERE id=? AND version=?)':'NOT EXISTS(SELECT 1 FROM business_records WHERE id=?)');params.push(r.id);if(old)params.push(old.version);}
 const write=crypto.randomUUID(),now=Date.now(),result={receiptId,inserted:fresh.length,skipped:records.length-fresh.length,ids:records.map(r=>r.id)};
 const statements=[db.prepare(`INSERT INTO business_write_guards(id,valid) SELECT ?,CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE 0 END`).bind(write,...params),...fresh.flatMap(r=>mutationStatements(db,r,1,r.state,now)),db.prepare('INSERT INTO business_imports(id,result_json,recorded_at) VALUES(?,?,?)').bind(receiptId,JSON.stringify(result),now),db.prepare('DELETE FROM business_write_guards WHERE id=?').bind(write)];
 try{await db.batch(statements);}catch{const done=await db.prepare('SELECT result_json FROM business_imports WHERE id=?').bind(receiptId).first();if(done)return {...JSON.parse(done.result_json),alreadyApplied:true};throw new BusinessError('同時更新を検出しました。この10件のコピーは反映していません',409,'BUSINESS_CONFLICT');}
 return result;
}
export async function businessSummary(db,{projectId='',period:month=''}={}){
 project(projectId);if(month)period(month);await initBusiness(db);
 const args=[],where=["state='active'","kind='finance'"];
 if(projectId){where.push('project_id=?');args.push(projectId);}if(month){where.push("substr(json_extract(payload_json,'$.date'),1,7)=?");args.push(month);}
 const totals=await db.prepare(`SELECT COUNT(*) AS entries,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.type')='revenue' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS revenueMinor,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.type')='expense' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS expenseMinor,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.type')='api' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS apiMinor FROM business_records WHERE ${where.join(' AND ')}`).bind(...args).first();
 const metricArgs=[],metricWhere=["state='active'","kind='metrics'"];
 if(projectId){metricWhere.push('project_id=?');metricArgs.push(projectId);}if(month){metricWhere.push("json_extract(payload_json,'$.period')=?");metricArgs.push(month);}
 const metrics=(await db.prepare(`SELECT id,version,payload_json FROM business_records WHERE ${metricWhere.join(' AND ')} ORDER BY id LIMIT 101`).bind(...metricArgs).all()).results;
 return {projectId,period:month||null,currency:'JPY',entries:totals.entries,recordedTotals:totals.entries?{revenue:totals.revenueMinor/100,expense:totals.expenseMinor/100,api:totals.apiMinor/100,difference:(totals.revenueMinor-totals.expenseMinor-totals.apiMinor)/100}:null,metrics:metrics.slice(0,100).map(({payload_json,...row})=>{const m=JSON.parse(payload_json);return {...row,...m,ctr:m.visits?m.clicks/m.visits:null,conversionRate:m.clicks?m.conversions/m.clicks:null};}),metricsPartial:metrics.length>100,actualProfit:null,notice:'利用者が入力・コピーした記録の集計です。実売上・実利益や請求の自動取得ではありません。記事別と全体、異なる計測元の件数は合算していません。USDのAI利用台帳も円の差額へ自動加算しません'};
}
