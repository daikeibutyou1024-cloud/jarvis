import {editorialReport} from './editorial.js';
import {japanDay} from "./calendar.js";
export {japanDay} from "./calendar.js";
export async function operationalReport(db,date){
 const day=japanDay(date),exists=async name=>!!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
 const report={date:day.date,timezone:day.timezone,periodStart:new Date(day.start).toISOString(),periodEnd:new Date(day.end).toISOString(),collection:null,inbox:null,ai:null,editorial:null,revenue:null,profit:null,bookkeeping:null,financialNotice:'売上・利益は未連携です。端末の手入力収支や外部サービスの成果を自動取得した値ではありません'};
 if(await exists('collection_runs')){
  const states=(await db.prepare('SELECT state,COUNT(*) AS count FROM collection_runs WHERE started_at>=? AND started_at<? GROUP BY state').bind(day.start,day.end).all()).results;
  report.collection={attempts:states.reduce((n,r)=>n+r.count,0),states};
 }
 if(await exists('research_inbox')){
  report.inbox={...(await db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN state='new' THEN 1 ELSE 0 END),0) AS pending FROM research_inbox").first()),acquiredToday:(await db.prepare('SELECT COUNT(*) AS n FROM research_inbox WHERE created_at>=? AND created_at<?').bind(day.start,day.end).first()).n};
 }
 if(await exists('ai_operations')){
  report.ai=await db.prepare('SELECT COUNT(*) AS attempts,COALESCE(SUM(charged_micro),0) AS committedMicroUSD,COALESCE(SUM(CASE WHEN state IN (\'running\',\'uncertain\',\'interrupted\',\'overrun\') THEN 1 ELSE 0 END),0) AS unresolved FROM ai_operations WHERE started_at>=? AND started_at<?').bind(day.start,day.end).first();
  report.ai.currency='USD';report.ai.invoiceVerified=false;report.ai.notice='当日開始分の設定料金による管理値・予約額です。請求実額とは未照合。日次回数上限は別途UTC単位です';
 }
 if(await exists('business_records')){
  const totals=await db.prepare("SELECT COUNT(*) AS entries,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.type')='revenue' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS revenueMinor,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.type')='expense' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS expenseMinor,COALESCE(SUM(CASE WHEN json_extract(payload_json,'$.type')='api' THEN json_extract(payload_json,'$.amountMinor') ELSE 0 END),0) AS apiMinor FROM business_records WHERE state='active' AND kind='finance' AND json_extract(payload_json,'$.date')=?").bind(day.date).first();
  if(totals.entries)report.bookkeeping={entries:totals.entries,currency:'JPY',recordedRevenue:totals.revenueMinor/100,recordedExpense:totals.expenseMinor/100,recordedApi:totals.apiMinor/100,recordedDifference:(totals.revenueMinor-totals.expenseMinor-totals.apiMinor)/100,source:'user_provided',actualProfit:null};
 }
 if(await exists('document_revisions')){
  const rows=(await db.prepare("SELECT d.*,EXISTS(SELECT 1 FROM sqlite_master WHERE name='editorial_reviews') AS reviews_available FROM document_revisions d WHERE revision=(SELECT MAX(revision) FROM document_revisions WHERE project_id=d.project_id) AND json_extract(payload,'$.workflow.version')=1 ORDER BY d.rowid DESC LIMIT 201").all()).results;
  const selected=rows.slice(0,200);const counts={planning:0,drafting:0,review_pending:0,review_recorded:0,invalid:0};
  for(const row of selected){try{const doc=JSON.parse(row.payload),r=editorialReport(doc);if(!r.readyForReview)counts[r.stage]++;else{const review=row.reviews_available?await db.prepare('SELECT revision FROM editorial_reviews WHERE project_id=? AND revision=?').bind(row.project_id,row.revision).first():null;counts[review?'review_recorded':'review_pending']++;}}catch{counts.invalid++;}}
  report.editorial={scanned:selected.length,partial:rows.length>200,counts,notice:'現在の最新案件を最大200件集計。確認記録の有無を表示し、公開可能性や品質を保証する集計ではありません'};
 }
 return report;
}
