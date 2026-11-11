import {period,id as recordId,CHANNELS} from './business-records.js';
const PAGE=25;
export async function monthlyReport(db,month,before=null,now=Date.now()){
 period(month);if(before!==null){if(before!=='')recordId(before);}
 const exists=async name=>!!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
 const hasRecords=await exists('business_records'),hasDocuments=await exists('document_revisions');
 const result={period:month,timezone:'Asia/Tokyo',asOf:new Date(now).toISOString(),projects:[],nextCursor:null,coverage:{records:hasRecords,documents:hasDocuments},actualRevenue:null,actualProfit:null,notice:'現在有効な入力済み記録の月次集計です。外部の売上・成果・公開状態は未取得。過去時点の復元や実利益ではありません。円とUSD、全体と案件別、異なる計測元の件数を合算しません。複数の読取は同一時点を保証しません'};
 if(!hasRecords&&!hasDocuments)return result;
 const terms=[],args=[];
 if(hasDocuments)terms.push('SELECT project_id FROM document_revisions');
 if(hasRecords){terms.push("SELECT project_id FROM business_records WHERE state='active' AND COALESCE(json_extract(payload_json,'$.period'),substr(json_extract(payload_json,'$.date'),1,7))=?");args.push(month);}
 const rows=(await db.prepare(`SELECT DISTINCT project_id FROM (${terms.join(' UNION ')}) WHERE (? IS NULL OR project_id>?) ORDER BY project_id LIMIT ${PAGE+1}`).bind(...args,before,before).all()).results;
 const ids=rows.slice(0,PAGE).map(r=>r.project_id);if(!ids.length)return result;
 result.nextCursor=rows.length>PAGE?ids.at(-1):null;
 const placeholders=ids.map(()=>'?').join(',');
 const documents=hasDocuments?(await db.prepare(`SELECT d.project_id,d.revision,d.payload FROM document_revisions d WHERE d.project_id IN (${placeholders}) AND d.revision=(SELECT MAX(revision) FROM document_revisions WHERE project_id=d.project_id)`).bind(...ids).all()).results:[];
 let finance=[],metrics=[],publications=[];
 if(hasRecords){
  const invalid=await db.prepare(`SELECT COUNT(*) AS n FROM business_records WHERE kind='finance' AND state='active' AND project_id IN (${placeholders}) AND substr(json_extract(payload_json,'$.date'),1,7)=? AND json_extract(payload_json,'$.currency')='JPY' AND (json_type(payload_json,'$.amountMinor') IS NOT 'integer' OR json_extract(payload_json,'$.amountMinor')<=0 OR json_extract(payload_json,'$.amountMinor')>99999999900 OR json_extract(payload_json,'$.type') IS NULL OR json_extract(payload_json,'$.type') NOT IN ('revenue','expense','api'))`).bind(...ids,month).first();
  if(invalid.n)throw Error('収支の保存形式が不正なため集計を停止しました');
  finance=(await db.prepare(`SELECT project_id,COUNT(*) AS all_entries,SUM(CASE WHEN json_extract(payload_json,'$.currency')='JPY' THEN 1 ELSE 0 END) AS entries,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.currency')='JPY' AND json_extract(payload_json,'$.type')='revenue' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS revenue,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.currency')='JPY' AND json_extract(payload_json,'$.type')='expense' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS expense,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.currency')='JPY' AND json_extract(payload_json,'$.type')='api' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS api FROM business_records WHERE kind='finance' AND state='active' AND project_id IN (${placeholders}) AND substr(json_extract(payload_json,'$.date'),1,7)=? GROUP BY project_id`).bind(...ids,month).all()).results;
  metrics=(await db.prepare(`SELECT project_id,payload_json FROM business_records WHERE kind='metrics' AND state='active' AND project_id IN (${placeholders}) AND json_extract(payload_json,'$.period')=? ORDER BY project_id,id LIMIT 1001`).bind(...ids,month).all()).results;
  publications=(await db.prepare(`SELECT project_id,COUNT(*) AS records FROM business_records WHERE kind='publication' AND state='active' AND project_id IN (${placeholders}) AND substr(json_extract(payload_json,'$.date'),1,7)=? GROUP BY project_id`).bind(...ids,month).all()).results;
 }
 if(metrics.length>1000)throw Error('計測記録が多すぎるため正確な集計を停止しました');
 result.projects=ids.map(projectId=>{
  const row=documents.find(d=>d.project_id===projectId),doc=row?JSON.parse(row.payload):null,f=finance.find(f=>f.project_id===projectId),p=publications.find(p=>p.project_id===projectId);
  const measured=metrics.filter(r=>r.project_id===projectId).map(r=>{const m=JSON.parse(r.payload_json);for(const key of ['visits','clicks','conversions'])if(!Number.isSafeInteger(m[key])||m[key]<0||m[key]>1000000000)throw Error('計測値が不正です');if(!CHANNELS.includes(m.channel))throw Error('計測元が不正です');if(m.clicks>m.visits||m.conversions>m.clicks)throw Error('計測範囲が不正です');return {channel:m.channel,visits:m.visits,clicks:m.clicks,conversions:m.conversions,ctr:m.visits?m.clicks/m.visits:null,conversionRate:m.clicks?m.conversions/m.clicks:null};});
  if(new Set(measured.map(m=>m.channel)).size!==measured.length)throw Error('同じ計測範囲が重複しています');
  const totals=f?.entries?{currency:'JPY',entries:f.entries,revenue:f.revenue/100,expense:f.expense/100,api:f.api/100,difference:(f.revenue-f.expense-f.api)/100}:null;
  const suggestions=[];
  if(!measured.length)suggestions.push('成果の計測値が未入力です。対象月と計測元を確認して入力してください');
  if(!totals)suggestions.push('収支が未入力です。未入力を売上0円と判断しないでください');
  if(!p)suggestions.push('この月の手動公開記録はありません。未公開とは断定できません');
  if(measured.some(m=>m.clicks>0&&m.conversions===0))suggestions.push('入力上はクリック後の成果が0件の計測元があります。計測条件と公開先の導線を確認してください');
  return {projectId,title:projectId===''?'案件未指定の記録':typeof doc?.topic==='string'?doc.topic:'保存案件の名称は未取得',revision:row?.revision??null,scope:projectId===''?'unassigned':'project',recordedTotals:totals,excludedCurrencyEntries:f?f.all_entries-f.entries:0,metrics:measured,manualPublicationRecords:p?.records??null,externalVerified:false,actualProfit:null,suggestions,suggestionsBasis:'入力の有無と件数に基づく確認事項です。AIによる評価や収益予測ではありません'};
 });
 return result;
}
