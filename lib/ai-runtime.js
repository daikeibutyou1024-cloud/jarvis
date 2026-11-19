import {PREPAID,prepaidPolicy,creditAmountSQL,creditFilterSQL,jstDay} from './preview-prepaid.js';
import {validSession} from './preview-session.js';
import {LIVE_TEST,previewLivePolicy} from './preview-live-policy.js';
import {createDiagnostic} from './ai-diagnostics.js';
import {usdMicro,openingMicro} from './ai-money.js';
import { reserveAI } from './ai-quota.js';
import { normalizeResult } from './generation.js';
export const AI_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ai_operations (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, job_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, month TEXT NOT NULL, state TEXT NOT NULL, reserved_micro INTEGER NOT NULL, charged_micro INTEGER NOT NULL, input_rate REAL NOT NULL, output_rate REAL NOT NULL, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER, usage_json TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_operations_month ON ai_operations(month)`,
];
export class AIError extends Error {
  constructor(message, code, status = 503) { super(message); this.code = code; this.status = status; }
}
export async function initAI(db) { for (const sql of AI_SCHEMA) await db.prepare(sql).run(); }
export async function recoverAI(db, now = Date.now()) {
  await initAI(db);
  await db.prepare("UPDATE ai_operations SET state='interrupted',finished_at=? WHERE state='running' AND expires_at<=?").bind(now, now).run();
}
export function aiConfig(env, prompt, maxOutput, now = Date.now()) {
  const provider = String(env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (!['anthropic', 'openai'].includes(provider)) throw new AIError('AI_PROVIDERが不正です', 'AI_CONFIG');
  const model = provider === 'anthropic' ? env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' : env.OPENAI_MODEL || 'gpt-4.1-mini';
  const key = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!key) throw new AIError('AI APIが未設定です', 'AI_CONFIG');
  const usd = env.AI_MONTHLY_BUDGET_USD;
  let budget;try{budget=usdMicro(usd);}catch{budget=NaN;}
  let price;
  try { price = JSON.parse(env.AI_PRICING_JSON)[`${provider}/${model}`]; } catch {}
  const validRate = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 5000000 || !validRate(price?.input) || !validRate(price?.output))
    throw new AIError('AI予算・モデル料金が未設定または不正です。設定を確認するまでAI処理を停止します', 'AI_BUDGET_CONFIG');
  // UTF-8 bytes plus a fixed protocol allowance bounds this text-only request conservatively.
  let opening;
  try{opening=openingMicro(env,new Date(now).toISOString().slice(0,7));}
  catch{throw new AIError('開始時点の利用額設定が不正です','AI_BUDGET_CONFIG');}
  const inputBound = new TextEncoder().encode(prompt).length + 1024;
  const reserve = Math.ceil(inputBound * price.input + maxOutput * price.output);
  if (!Number.isSafeInteger(reserve) || reserve < 1) throw new AIError('予約金額が不正です', 'AI_BUDGET_CONFIG');
  return { provider, model, key, budget, reserve, price, opening };
}
// Local ledger cannot prove provider balance or spending through other clients.
// No environment flag or caller-supplied assertion may override this fail-closed policy.
export function liveAIPolicy(){return {budgetUSD:5,scope:'total API spending',verified:false,allowed:false,reason:'API残高・他経路の消費を確認できないため実生成を停止しています。5 USD上限は未保証です。'};}
export function requireVerifiedLiveBudget(){throw new AIError(liveAIPolicy().reason,'AI_BUDGET_UNVERIFIED',503);}
export async function runAI(env, purpose, prompt, maxOutput, jobId = null, diagnostic = createDiagnostic()) {
  requireVerifiedLiveBudget();
  try {
    const result=await executeAI(env,purpose,prompt,maxOutput,jobId,diagnostic);
    result.generation.diagnostic=diagnostic.finish();
    return result;
  } catch(error) {
    const code=error instanceof AIError ? error.code : 'AI_FAILED';
    const snapshot=diagnostic.finish(code);
    const safe=error instanceof AIError ? error : new AIError('AI処理に失敗しました。診断IDで履歴を確認してください','AI_FAILED',502);
    safe.diagnostic=snapshot;
    throw safe;
  }
}
// Separate, expiring Preview-only one-shot grant. General runAI stays fail-closed.
export async function runPreviewLiveOnce(request,env,prompt){
 if(!await validSession(request,env))throw new AIError("認証が必要です","PREVIEW_LIVE_AUTH",401);
 const policy=previewLivePolicy(request,env);
 if(!policy.allowed)throw new AIError(policy.reason,'PREVIEW_LIVE_BLOCKED',503);
 if(new TextEncoder().encode(prompt).length>LIVE_TEST.maxPromptBytes)throw new AIError('テスト入力が長すぎます','PREVIEW_LIVE_INPUT',400);
 const marker=await env.JARVIS_DB.prepare("SELECT report_json FROM autonomous_reports WHERE owner_id='__binding__' AND report_day='jarvis-preview'").first();
 if(!marker||JSON.parse(marker.report_json).databaseId!==LIVE_TEST.previewDB)throw new AIError('Preview DBの識別に失敗しました','PREVIEW_LIVE_DB',503);
 return executeAI(env,'voice-live-once',prompt,LIVE_TEST.maxOutput,null,createDiagnostic(),{oneShot:true,creditPolicy:policy});
}
export async function runPreviewThreads(request,env,prompt){
 if(!await validSession(request,env))throw new AIError('認証が必要です','PREPAID_AUTH',401);
 const policy=prepaidPolicy(request,env,'threads-draft');
 if(!policy.allowed)throw new AIError(policy.reason,'PREPAID_BLOCKED',503);
 if(new TextEncoder().encode(prompt).length>PREPAID.maxPromptBytes)throw new AIError('入力が長すぎます','PREPAID_INPUT',400);
 const marker=await env.JARVIS_DB.prepare("SELECT report_json FROM autonomous_reports WHERE owner_id='__binding__' AND report_day='jarvis-preview'").first();
 if(!marker||JSON.parse(marker.report_json).databaseId!==PREPAID.previewDB)throw new AIError('Preview DBを確認できません','PREPAID_DB',503);
 return executeAI(env,'threads-draft',prompt,policy.maxOutput,null,createDiagnostic(),{oneShot:true,creditPolicy:policy,operationId:'jarvis-preview-threads-'+policy.day});
}
export async function runPreviewConversation(request,env,prompt,messages,system,requestId){
 if(!await validSession(request,env))throw new AIError('認証が必要です','PREPAID_AUTH',401);
 const policy=prepaidPolicy(request,env,'conversation');
 if(!policy.allowed)throw new AIError(policy.reason,'PREPAID_BLOCKED',503);
 if(new TextEncoder().encode(prompt).length>4096)throw new AIError('会話が長すぎます','PREPAID_INPUT',400);
 const marker=await env.JARVIS_DB.prepare("SELECT report_json FROM autonomous_reports WHERE owner_id='__binding__' AND report_day='jarvis-preview'").first();
 if(!marker||JSON.parse(marker.report_json).databaseId!==PREPAID.previewDB)throw new AIError('Preview DBを確認できません','PREPAID_DB',503);
 if(await env.JARVIS_DB.prepare('SELECT id FROM ai_operations WHERE id=?').bind('jarvis-preview-chat-'+requestId).first())throw new AIError('同じ送信は処理済みまたは結果未確認です。再送しません。','CHAT_DUPLICATE',409);
 return executeAI(env,'conversation',prompt,policy.maxOutput,policy.grantId,createDiagnostic(),{oneShot:true,creditPolicy:policy,operationId:'jarvis-preview-chat-'+requestId,messages,system});
}
async function executeAI(env, purpose, prompt, maxOutput, jobId, diagnostic, {oneShot=false,creditPolicy=null,operationId=null,messages=null,system=null}={}) {
  const now = Date.now();
  const c = creditPolicy?{provider:'anthropic',model:PREPAID.model,key:env.ANTHROPIC_API_KEY,price:{input:3,output:15},reserve:creditPolicy.maxMicroUSD}:aiConfig(env, prompt, maxOutput,now);
  const db = env.JARVIS_DB;
  if (!db) throw new AIError('D1未接続です', 'AI_CONFIG');
  diagnostic.stage('budget_preparation');
  if(!oneShot)await recoverAI(db);
  const id = operationId||(oneShot?LIVE_TEST.id:crypto.randomUUID()), month = new Date(now).toISOString().slice(0, 7);
  const rawTimeout = Number(env.AI_TIMEOUT_MS || 30000);
  const timeout = Number.isFinite(rawTimeout) ? Math.max(10, Math.min(60000, rawTimeout)) : 30000;
  diagnostic.operation(id,timeout);
  let reserved;try{reserved = creditPolicy?await db.prepare(`INSERT INTO ai_operations(id,purpose,job_id,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at)
    SELECT ?,?,?,?,?,?,'running',?,?,?,?,?,? WHERE ?-(SELECT COALESCE(SUM(${creditAmountSQL}),0) FROM ai_operations WHERE ${creditFilterSQL})>=?
    AND NOT EXISTS(SELECT 1 FROM ai_operations WHERE state='overrun' AND provider='anthropic')
    ${purpose==='conversation'?`AND NOT EXISTS(SELECT 1 FROM ai_operations WHERE purpose='conversation' AND (state IN ('running','uncertain','interrupted','overrun') OR started_at>?)) AND (SELECT COUNT(*) FROM ai_operations WHERE purpose='conversation' AND job_id=?)<?`:''}`)
    .bind(id,purpose,jobId,c.provider,c.model,month,c.reserve,c.reserve,c.price.input,c.price.output,now,now+timeout+5000,creditPolicy.snapshot.balanceMicroUSD,creditPolicy.snapshot.settledThrough,c.reserve,...(purpose==='conversation'?[now-5000,creditPolicy.grantId,creditPolicy.maxCalls]:[])).run():await db.prepare(`INSERT INTO ai_operations(id,purpose,job_id,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at)
    SELECT ?,?,?,?,?,?,'running',?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(charged_micro),0) FROM ai_operations WHERE month=?) + ? + ? <= ?
    AND NOT EXISTS (SELECT 1 FROM ai_operations WHERE state='overrun' OR (state IN ('running','interrupted','uncertain') AND month<>?))`)
    .bind(id,purpose,jobId,c.provider,c.model,month,c.reserve,c.reserve,c.price.input,c.price.output,now,now+timeout+5000,month,c.reserve,c.opening,c.budget,month).run();}catch(error){if(oneShot)throw new AIError("本日の生成または1回限定テストは使用済み、または予約を確認できません。再送しません。","PREVIEW_LIVE_USED",409);throw error;}
  if (!reserved.meta?.changes) throw new AIError(creditPolicy?'残高・未確定処理・送信間隔・承認回数の条件により停止しました。自動再送しません。':'AI月額予算を超えるため停止しました。前月の未確定利用が残っている場合も停止します', 'AI_BUDGET_EXCEEDED', 429);
  const finish = async (state, charged, usage = null) => {
    const savedUsage=creditPolicy?{...(usage||{}),prepaid:{snapshotObservedAt:creditPolicy.snapshot.observedAt,snapshotBalanceMicroUSD:creditPolicy.snapshot.balanceMicroUSD,settledThrough:creditPolicy.snapshot.settledThrough,recordedAt:Date.now()}}:usage;
    const r = creditPolicy?await db.prepare(`UPDATE ai_operations SET state=?,charged_micro=?,finished_at=?,usage_json=json_set(?,'$.prepaid.estimatedBalanceMicroUSD',MAX(0,? - ((SELECT COALESCE(SUM(${creditAmountSQL}),0) FROM ai_operations WHERE ${creditFilterSQL}) - reserved_micro + ?))) WHERE id=? AND state='running'`)
      .bind(state,charged,Date.now(),JSON.stringify(savedUsage),creditPolicy.snapshot.balanceMicroUSD,creditPolicy.snapshot.settledThrough,charged,id).run():await db.prepare("UPDATE ai_operations SET state=?,charged_micro=?,finished_at=?,usage_json=? WHERE id=? AND state='running'")
      .bind(state,charged,Date.now(),usage ? JSON.stringify(usage) : null,id).run();
    if (!r.meta?.changes) throw new AIError('中断したAI処理の応答は採用しません。実行履歴を確認してください', 'AI_INTERRUPTED');
  };
  let sent = false, timer;
  const controller = new AbortController();
  try {
    diagnostic.stage('quota');
    if (!(await reserveAI(env, purpose,Math.floor(now/1000),{preserveHistory:oneShot}))) { await finish('cancelled',0); throw new AIError('本日のAI利用上限です（全体10回・企画2回・クラウド5回、UTC・失敗含む）', 'AI_QUOTA',429); }
    const active = await db.prepare("SELECT state,expires_at FROM ai_operations WHERE id=?").bind(id).first();
    if(!active || active.state!=="running" || active.expires_at<=Date.now()) throw new AIError("実行期限を過ぎた処理は送信しません", "AI_INTERRUPTED");
    const payload = { model:c.model, max_tokens:maxOutput, messages:messages||[{role:'user',content:prompt}],...(system?{system}: {}) };
    const response = async () => {
      diagnostic.stage('provider_headers');
      sent = true;
      const r = await fetch(c.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions', {
        method:'POST', signal:controller.signal,
        headers:c.provider === 'anthropic' ? {'content-type':'application/json','x-api-key':c.key,'anthropic-version':'2023-06-01'} : {'content-type':'application/json',Authorization:'Bearer '+c.key},
        body:JSON.stringify(payload),
      });
      if(controller.signal.aborted) throw new AIError('中断した応答は採用しません','AI_TIMEOUT',504);
      diagnostic.upstream(r);
      if(!r.ok){
        if(creditPolicy&&r.status===400){let detail;try{detail=await r.json();}catch{}if(/credit balance|insufficient.*credit/i.test(detail?.error?.message||detail?.error||''))throw new AIError('Anthropicの残高が不足しています。生成を停止し、再送しません。','AI_CREDITS',502);}
        throw new AIError('AI APIへの接続に失敗しました。自動再試行は行いません','AI_UPSTREAM',502);
      }
      diagnostic.stage('provider_body');
      let data;
      try { data = await r.json(); } catch(error) { if(controller.signal.aborted) throw error; throw new AIError('AI応答の形式が不正です','AI_RESPONSE_INVALID',502); }
      if(controller.signal.aborted) throw new AIError('中断した応答は採用しません','AI_TIMEOUT',504);
      diagnostic.stage('result_validation');
      return normalizeResult(data,c.provider,c.model);
    };
    const result = await Promise.race([response(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AIError('AI処理がタイムアウトしました。課金未確定の予約額を保持します', 'AI_TIMEOUT',504));},timeout);})]);
    diagnostic.stage('cost_recording');
    const u = result.generation.usage;
    const known = Number.isSafeInteger(u.input_tokens) && Number.isSafeInteger(u.output_tokens) && !u.cache_creation_input_tokens && !u.cache_read_input_tokens;
    const actual = known ? Math.ceil(u.input_tokens*c.price.input + u.output_tokens*c.price.output) : c.reserve;
    await finish(actual>c.reserve ? 'overrun' : known ? 'completed' : 'uncertain',actual,u);
    result.generation.operationId = id;
    result.generation.cost = { currency:'USD', microUSD:actual, basis:known ? 'configured_rates_and_reported_tokens' : 'reserved_upper_bound', invoiceVerified:false };
    return result;
  } catch (error) {
    // Never refund an attempted request whose billing outcome is unknown.
    if(creditPolicy){const row=await db.prepare('SELECT state FROM ai_operations WHERE id=?').bind(id).first();if(row?.state==='running')await finish(sent?'uncertain':'cancelled',sent?c.reserve:0);}
    else await db.prepare("UPDATE ai_operations SET state=?,charged_micro=?,finished_at=? WHERE id=? AND state='running'").bind(sent ? 'uncertain' : 'cancelled',sent ? c.reserve : 0,Date.now(),id).run();
    if (error instanceof AIError) throw error;
    throw new AIError('AI処理に失敗しました。実行履歴を確認してください。自動再試行は行いません', 'AI_FAILED',502);
  } finally { clearTimeout(timer); }
}
export function aiFailure(error) { return error instanceof AIError ? { error:error.message,code:error.code,...(error.diagnostic?{diagnostic:error.diagnostic}:{}) } : null; }
