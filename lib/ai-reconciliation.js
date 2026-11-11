export const RECONCILIATION_SCHEMA=`CREATE TABLE IF NOT EXISTS ai_reconciliations (operation_id TEXT PRIMARY KEY, prior_state TEXT NOT NULL, prior_charged_micro INTEGER NOT NULL, prior_usage_json TEXT, charged_micro INTEGER NOT NULL, note TEXT NOT NULL, recorded_at INTEGER NOT NULL, valid INTEGER NOT NULL CHECK(valid=1))`;
export const unresolvedAIStates=['uncertain','interrupted','overrun'];
export class ReconciliationError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export async function initReconciliations(db){await db.prepare(RECONCILIATION_SCHEMA).run();}
export function validateReconciliation(b){
 if(!b||b.confirmed!==true||typeof b.id!=='string'||!b.id||b.id.length>100||!Number.isSafeInteger(b.chargedMicroUSD)||b.chargedMicroUSD<0||b.chargedMicroUSD>1e12||typeof b.note!=='string'||!b.note.trim()||b.note.length>500)throw new ReconciliationError('請求を確認した金額と照合メモが必要です');
 if(b.expectedState!==undefined&&!unresolvedAIStates.includes(b.expectedState))throw new ReconciliationError('照合対象の状態を確認してください');
 if(b.expectedChargedMicroUSD!==undefined&&(!Number.isSafeInteger(b.expectedChargedMicroUSD)||b.expectedChargedMicroUSD<0))throw new ReconciliationError('照合前の管理値を確認してください');
}
export async function reconcileAI(db,b,now=Date.now()){
 validateReconciliation(b);
 await initReconciliations(db);
 const note=b.note.trim();
 const already=async()=>{
  const audit=await db.prepare("SELECT a.operation_id FROM ai_reconciliations a JOIN ai_operations o ON o.id=a.operation_id WHERE a.operation_id=? AND a.charged_micro=? AND a.note=? AND o.state='reconciled' AND o.charged_micro=a.charged_micro").bind(b.id,b.chargedMicroUSD,note).first();
  return !!audit;
 };
 if(await already())return {reconciled:true,alreadyReconciled:true};
 const old=await db.prepare('SELECT state,charged_micro,usage_json,finished_at FROM ai_operations WHERE id=?').bind(b.id).first();
 if(!old||!unresolvedAIStates.includes(old.state)||(b.expectedState!==undefined&&b.expectedState!==old.state)||(b.expectedChargedMicroUSD!==undefined&&b.expectedChargedMicroUSD!==old.charged_micro))throw new ReconciliationError('照合対象が変更されたか、処理中または照合済みです。履歴を再取得してください',409);
 try{
  await db.batch([
   db.prepare("UPDATE ai_operations SET state='reconciled',charged_micro=?,finished_at=? WHERE id=? AND state=? AND charged_micro=? AND usage_json IS ? AND finished_at IS ? AND NOT EXISTS(SELECT 1 FROM ai_reconciliations WHERE operation_id=?)").bind(b.chargedMicroUSD,now,b.id,old.state,old.charged_micro,old.usage_json,old.finished_at,b.id),
   // CHECK failure rolls the update and audit back together if the CAS did not write.
   db.prepare("INSERT INTO ai_reconciliations(operation_id,prior_state,prior_charged_micro,prior_usage_json,charged_micro,note,recorded_at,valid) VALUES(?,?,?,?,?,?,?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)").bind(b.id,old.state,old.charged_micro,old.usage_json,b.chargedMicroUSD,note,now),
  ]);
 }catch{if(await already())return {reconciled:true,alreadyReconciled:true};throw new ReconciliationError('同時更新または保存失敗により照合を反映できませんでした。元の利用情報は保持しています',409);}
 return {reconciled:true,alreadyReconciled:false};
}
