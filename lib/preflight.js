import {aiConfig} from './ai-runtime.js';
import {scheduleConfig} from './schedules.js';
// Fixed read contracts only. Never create a missing table or select user payloads.
export const READ_CONTRACTS={
 business_jobs:['id','job_type','topic','status','output','error','created_at','updated_at'],
 document_revisions:['project_id','revision','write_id','payload','created_at'],
 editorial_reviews:['project_id','revision','digest','checks_json','reviewed_at'],
 ai_operations:['id','purpose','job_id','provider','model','month','state','reserved_micro','charged_micro','input_rate','output_rate','started_at','expires_at','finished_at','usage_json'],
 ai_reconciliations:['operation_id','prior_state','prior_charged_micro','prior_usage_json','charged_micro','note','recorded_at','valid'],
 collection_schedules:['id','name','source','query','interval_minutes','enabled','version','next_run_at','updated_at'],
 collection_runs:['id','schedule_id','schedule_version','due_at','state','started_at','expires_at','finished_at','result_json'],
 research_inbox:['id','source','source_url','fingerprint','record_json','run_id','state','created_at'],
 business_records:['id','version','kind','project_id','payload_json','state','updated_at'],
 business_record_history:['record_id','version','payload_json','state','recorded_at'],
 business_imports:['id','result_json','recorded_at'],
 business_write_guards:['id','valid'],
};
const manualChecks=[
 {id:'database_isolation',state:'unverified',message:'PreviewとProductionのD1が別であることを管理画面で確認してください'},
 {id:'restore',state:'unverified',message:'既存データを含むバックアップと復元は別途検証が必要です'},
 {id:'billing',state:'unverified',message:'実契約の無料枠・課金設定・API請求との照合は未確認です'},
 {id:'authenticated_flows',state:'unverified',message:'Previewでの認証後の保存・再取得・競合動作は別途確認が必要です'},
 {id:'relay',state:'unverified',message:'起動元の配備・秘密の一致・時刻起動はこの確認では検証しません'},
 {id:'external_integrations',state:'unverified',message:'外部投稿・販売・成果取得の連携は未完成です'},
];
export async function inspectPreflight(env,now=Date.now()){
 const branch=env.CF_PAGES_BRANCH;
 const environment={state:branch==='feature/ai-business-rebuild'?'development_branch':branch?'other_branch':'unknown',notice:'ブランチ名は環境の申告値です。DBの分離や本番安全性の証明ではありません'};
 const tables=[];let database={state:'unavailable',tables};
 try{
  for(const [name,required] of Object.entries(READ_CONTRACTS)){
   const rows=(await env.JARVIS_DB.prepare(`PRAGMA table_info(${name})`).all()).results;
   const missingColumns=required.filter(c=>!rows.some(r=>r.name===c));
   tables.push({name,state:!rows.length?'missing':missingColumns.length?'incompatible_columns':'columns_present',missingColumns});
  }
  database.state=tables.every(t=>t.state==='columns_present')?'columns_present':'incomplete';
 }catch{database={state:'unavailable',tables,notice:'読み取りに失敗しました。接続先や権限を確認してください。修復・再試行は実行していません'};}
 database.notice=database.notice||'必須列の存在のみ確認しました。型・制約・索引・内容・書込権限・DBの分離は未検証です。未作成テーブルもここでは作成しません';
 const readable=name=>database.state!=='unavailable'&&tables.find(t=>t.name===name)?.state==='columns_present';
 let ai={state:'unconfigured',code:'AI_CONFIG',notice:'APIへ接続せず設定形式だけを確認します'};let config;
 try{config=aiConfig(env,'',1,now);ai={state:'configured_unverified',provider:config.provider,notice:'設定形式のみ確認。実認証・料金の正しさ・請求・実際の生成可否は未確認です'};}
 catch(e){ai.code=['AI_CONFIG','AI_BUDGET_CONFIG'].includes(e.code)?e.code:'AI_CONFIG';}
 if(config){
  if(!readable('ai_operations'))ai={...ai,state:'ledger_unavailable'};
  else try{
   const month=new Date(now).toISOString().slice(0,7);
   const row=await env.JARVIS_DB.prepare("SELECT COALESCE(SUM(CASE WHEN month=? THEN charged_micro ELSE 0 END),0) AS committed,COALESCE(SUM(CASE WHEN state='overrun' OR (state IN ('running','interrupted','uncertain') AND month<>?) THEN 1 ELSE 0 END),0) AS blockers,COALESCE(SUM(CASE WHEN state='running' AND expires_at<=? THEN 1 ELSE 0 END),0) AS expired FROM ai_operations").bind(month,month,now).first();
   ai={...ai,month,budgetMicroUSD:config.budget,openingMicroUSD:config.opening,committedMicroUSD:row.committed,remainingMicroUSD:Math.max(0,config.budget-config.opening-row.committed),blockingOperations:row.blockers,expiredRunning:row.expired};
   if(row.blockers||config.opening+row.committed>=config.budget)ai.state='blocked';
  }catch{ai={state:'unavailable',notice:'AI台帳の読取に失敗しました。設定や利用データは変更していません'};}
 }
 let collection={state:'invalid_config',reasons:['configuration']};
 try{
  const c=scheduleConfig(env);collection={state:c.enabled?'unavailable':'disabled',enabled:c.enabled,hasDedicatedToken:c.hasToken,dailyLimit:c.dailyLimit,reasons:[]};
  if(!c.enabled)collection.reasons.push('global_stop');if(!c.hasToken)collection.reasons.push('dedicated_token_missing');
  if(['collection_schedules','collection_runs','research_inbox'].every(readable)){
   const day=Math.floor(now/86400000)*86400000;
   const row=await env.JARVIS_DB.prepare("SELECT (SELECT COUNT(*) FROM collection_schedules WHERE enabled=1 AND next_run_at<=?) AS due,(SELECT COUNT(*) FROM collection_runs WHERE state='running' AND expires_at>?) AS active,(SELECT COUNT(*) FROM collection_runs WHERE state='running' AND expires_at<=?) AS expired,(SELECT COUNT(*) FROM collection_runs WHERE started_at>=? AND started_at<?) AS attempts,(SELECT COUNT(*) FROM research_inbox) AS inbox").bind(now,now,now,day,day+86400000).first();
   collection.snapshot={due:row.due,running:row.active,expiredRunning:row.expired,attemptsTodayUTC:row.attempts,inbox:row.inbox};
   if(row.inbox>=500)collection.reasons.push('inbox_capacity');if(row.active)collection.reasons.push('already_running');if(row.attempts>=c.dailyLimit)collection.reasons.push('daily_limit');if(!row.due)collection.reasons.push('nothing_due');
   collection.state=!c.enabled?'disabled':collection.reasons.some(r=>r!=='nothing_due')?'blocked':row.due?'eligible_snapshot':'idle';
  }else{collection.reasons.push('storage_unavailable');if(c.enabled)collection.state='unavailable';}
 }catch{collection={state:'unavailable',reasons:['configuration_or_storage']};}
 collection.notice='複数の読取は同一時点を保証しません。現在の開始条件の見込みだけです。実行・予約・中断整理・外部取得は行いません。共有取得制限や通信結果は未確認で、実行時に再判定します';
 return {schema:'jarvis-preflight-v1',checkedAt:new Date(now).toISOString(),productionReady:false,environment,database,ai,collection,manualChecks,notice:'確認のみ。データ・設定の変更、AI呼出、定期収集の起動、自動再試行は行いません。本番反映の承認や安全性の保証ではありません'};
}
