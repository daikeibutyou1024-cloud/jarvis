import {previewHost,validSession} from '../../lib/preview-session.js';
import {applyOffice,OFFICE_MAX_MICRO,officePrompt,officeSummary} from '../../lib/virtual-office.js';
import {loadOffice,saveOffice} from '../../lib/office-store.js';
import {officePolicy} from '../../lib/office-policy.js';
import {runOfficeDraft} from '../../lib/ai-runtime.js';
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const error=(s,status=409)=>Object.assign(Error(s),{status});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({enabled:false,error:'VIRTUAL OFFICEはPreview専用です。'},403);
 if(!await validSession(request,env))return json({error:'ログインが必要です。'},401);
 if(env.JARVIS_VIRTUAL_OFFICE_ENABLED!=='true')return json({enabled:false,reason:'クラウドオフィスはOFFです。端末内管理を利用できます。外部投稿・実AIは稼働しません。',error:'クラウドオフィスは停止中です。操作は実行していません。'},request.method==='GET'?200:503);
 if(!['GET','POST'].includes(request.method))return json({error:'許可されていない操作です。'},405);
 if(request.method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'同一オリジンから操作してください。'},403);
 let claimed=false;
 try{
  if(!env.JARVIS_DB)throw error('Preview DB未接続です。',503);
  const marker=await env.JARVIS_DB.prepare("SELECT report_json FROM autonomous_reports WHERE owner_id='__binding__' AND report_day='jarvis-preview'").first();
  if(!marker||JSON.parse(marker.report_json).databaseId!=='5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0')throw error('Preview DB識別が一致しません。操作を停止しました。',503);
  const state=await loadOffice(env.JARVIS_DB);
  if(request.method==='GET')return json({enabled:true,state,summary:officeSummary(state),liveConfigured:env.JARVIS_OFFICE_LIVE_ENABLED==='true',notice:'クラウドと端末内データは自動移行しません。'});
  const raw=await request.text();if(new TextEncoder().encode(raw).length>30000)throw error('操作が大きすぎます。',413);const c=JSON.parse(raw);
  if(c.type!=='run')return json({enabled:true,state:await saveOffice(env.JARVIS_DB,state,applyOffice(state,c,env),c.id)});
  if(!/^[-a-zA-Z0-9]{8,80}$/.test(c.runId||'')||!/^[-a-zA-Z0-9]{8,80}$/.test(c.id||''))throw error('実行IDが不正です。',400);
  const task=state.tasks.find(t=>t.id===c.taskId);if(!task||task.version!==c.expectedVersion||!['assigned','revision_requested','failed'].includes(task.status))throw error('タスクの状態・版を再確認してください。');
  if(state.runs.some(r=>r.id===c.runId||['running','uncertain','overrun'].includes(r.status)))throw error('実行済みまたは結果未確定です。再試行しません。');
  const consent=state.approvals.find(a=>a.action==='ai_spend'&&a.status==='approved'&&a.taskId===task.id&&a.taskVersion===task.version&&a.runId===c.runId&&a.maxMicroUSD===OFFICE_MAX_MICRO);
  const policy=officePolicy(request,env,task,c.runId);if(!consent||!policy.allowed)throw error(policy.reason||'費用承認が必要です。',503);
  const agent=state.agents.find(a=>a.id===task.agentId);if(!agent?.enabled||agent.budgetMicroUSD<OFFICE_MAX_MICRO)throw error('社員別の明示的な予算上限が未設定です。',429);officePrompt(task,env);
  const next=structuredClone(state),t=next.tasks.find(t=>t.id===task.id),now=Date.now();t.status='running';t.updatedAt=now;t.version++;t.history.push({at:now,event:'AI実行予約・自動再試行なし',actor:'owner'});
  next.runs.push({id:c.runId,taskId:task.id,agentId:task.agentId,taskVersion:task.version,status:'running',reservedMicroUSD:OFFICE_MAX_MICRO,createdAt:now});next.version++;
  await saveOffice(env.JARVIS_DB,state,next,c.id);claimed=true;
  let result,failure;try{result=await runOfficeDraft(request,env,task,c.runId);}catch(e){failure=e;}
  // Re-read after provider completes. Never resend if persistence fails or the result is unknown.
  const fresh=await loadOffice(env.JARVIS_DB),done=structuredClone(fresh),dt=done.tasks.find(t=>t.id===task.id),run=done.runs.find(r=>r.id===c.runId);
  const ledger=await env.JARVIS_DB.prepare('SELECT state,charged_micro,reserved_micro FROM ai_operations WHERE id=?').bind('jarvis-office-'+c.runId).first();
  if(dt?.status!=='running'||run?.status!=='running')throw error('実行結果の保存状態が変わりました。再送禁止です。');
  run.operationId='jarvis-office-'+c.runId;run.model='claude-sonnet-4-6';run.status=ledger?.state==='completed'&&result?'completed':ledger&&['uncertain','overrun','running','interrupted'].includes(ledger.state)?'uncertain':'failed';
  run.costMicroUSD=ledger?.charged_micro||0;run.usage=result?.generation?.usage||null;run.errorCode=failure?.code||null;run.finishedAt=Date.now();
  dt.status=run.status==='completed'?'review':run.status==='uncertain'?'uncertain':'failed';
  if(result&&run.status==='completed'){dt.revisions.push({version:dt.outputVersion,output:dt.output,source:dt.source,at:Date.now()});dt.output=result.text;dt.source='anthropic';dt.partial=result.generation?.completionStatus!=='complete'||!result.text?.trim();dt.outputVersion++;}
  dt.version++;dt.updatedAt=Date.now();dt.history.push({at:Date.now(),event:'AI実行:'+run.status,actor:'anthropic'});done.version++;
  await saveOffice(env.JARVIS_DB,fresh,done,crypto.randomUUID());
  return json({enabled:true,state:done,...(failure?{error:'制作は停止しました。履歴・費用を確認してください。自動再試行しません。',code:failure.code}:{})},failure?502:200);
 }catch(e){return json({error:claimed?'実行結果の確定・保存を確認できません。再送せず管理者の台帳照合を待ってください。':e.status?e.message:'Preview専用スキーマ・設定を確認できません。書き込み・送信を停止しました。',code:claimed?'OFFICE_UNCERTAIN':'OFFICE_STOPPED'},e.status||503);}
}
