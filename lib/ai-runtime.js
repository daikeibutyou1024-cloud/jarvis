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
  const budget = typeof usd === 'string' && /^\d+(?:\.\d{1,6})?$/.test(usd) ? Math.round(Number(usd) * 1e6) : NaN;
  let price;
  try { price = JSON.parse(env.AI_PRICING_JSON)[`${provider}/${model}`]; } catch {}
  const validRate = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 1e12 || !validRate(price?.input) || !validRate(price?.output))
    throw new AIError('AI予算・モデル料金が未設定または不正です。設定を確認するまでAI処理を停止します', 'AI_BUDGET_CONFIG');
  // UTF-8 bytes plus a fixed protocol allowance bounds this text-only request conservatively.
  let opening = 0;
  try {
    const value = JSON.parse(env.AI_OPENING_SPEND_USD_JSON || "{}")[new Date(now).toISOString().slice(0,7)] || "0";
    if(typeof value!=="string" || !/^\d+(?:\.\d{1,6})?$/.test(value))throw Error();
    opening=Math.round(Number(value)*1e6);
    if(!Number.isSafeInteger(opening)||opening<0||opening>1e12)throw Error();
  }catch{throw new AIError("開始時点の利用額設定が不正です", "AI_BUDGET_CONFIG");}
  const inputBound = new TextEncoder().encode(prompt).length + 1024;
  const reserve = Math.ceil(inputBound * price.input + maxOutput * price.output);
  if (!Number.isSafeInteger(reserve) || reserve < 1) throw new AIError('予約金額が不正です', 'AI_BUDGET_CONFIG');
  return { provider, model, key, budget, reserve, price, opening };
}
export async function runAI(env, purpose, prompt, maxOutput, jobId = null) {
  const now = Date.now();
  const c = aiConfig(env, prompt, maxOutput,now);
  const db = env.JARVIS_DB;
  if (!db) throw new AIError('D1未接続です', 'AI_CONFIG');
  await recoverAI(db);
  const id = crypto.randomUUID(), month = new Date(now).toISOString().slice(0, 7);
  const rawTimeout = Number(env.AI_TIMEOUT_MS || 30000);
  const timeout = Number.isFinite(rawTimeout) ? Math.max(10, Math.min(60000, rawTimeout)) : 30000;
  const reserved = await db.prepare(`INSERT INTO ai_operations(id,purpose,job_id,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at)
    SELECT ?,?,?,?,?,?,'running',?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(charged_micro),0) FROM ai_operations WHERE month=?) + ? + ? <= ?
    AND NOT EXISTS (SELECT 1 FROM ai_operations WHERE state='overrun' OR (state IN ('running','interrupted','uncertain') AND month<>?))`)
    .bind(id,purpose,jobId,c.provider,c.model,month,c.reserve,c.reserve,c.price.input,c.price.output,now,now+timeout+5000,month,c.reserve,c.opening,c.budget,month).run();
  if (!reserved.meta?.changes) throw new AIError('AI月額予算を超えるため停止しました。前月の未確定利用が残っている場合も停止します', 'AI_BUDGET_EXCEEDED', 429);
  const finish = async (state, charged, usage = null) => {
    const r = await db.prepare("UPDATE ai_operations SET state=?,charged_micro=?,finished_at=?,usage_json=? WHERE id=? AND state='running'")
      .bind(state,charged,Date.now(),usage ? JSON.stringify(usage) : null,id).run();
    if (!r.meta?.changes) throw new AIError('中断したAI処理の応答は採用しません。実行履歴を確認してください', 'AI_INTERRUPTED');
  };
  let sent = false, timer;
  const controller = new AbortController();
  try {
    if (!(await reserveAI(env, purpose))) { await finish('cancelled',0); throw new AIError('本日のAI利用上限です（全体10回・企画2回・クラウド5回、UTC・失敗含む）', 'AI_QUOTA',429); }
    const active = await db.prepare("SELECT state,expires_at FROM ai_operations WHERE id=?").bind(id).first();
    if(!active || active.state!=="running" || active.expires_at<=Date.now()) throw new AIError("実行期限を過ぎた処理は送信しません", "AI_INTERRUPTED");
    const payload = { model:c.model, max_tokens:maxOutput, messages:[{role:'user',content:prompt}] };
    const response = async () => {
      sent = true;
      const r = await fetch(c.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions', {
        method:'POST', signal:controller.signal,
        headers:c.provider === 'anthropic' ? {'content-type':'application/json','x-api-key':c.key,'anthropic-version':'2023-06-01'} : {'content-type':'application/json',Authorization:'Bearer '+c.key},
        body:JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new AIError('AI APIへの接続に失敗しました。自動再試行は行いません', 'AI_UPSTREAM',502);
      return normalizeResult(data,c.provider,c.model);
    };
    const result = await Promise.race([response(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AIError('AI処理がタイムアウトしました。課金未確定の予約額を保持します', 'AI_TIMEOUT',504));},timeout);})]);
    const u = result.generation.usage;
    const known = Number.isSafeInteger(u.input_tokens) && Number.isSafeInteger(u.output_tokens) && !u.cache_creation_input_tokens && !u.cache_read_input_tokens;
    const actual = known ? Math.ceil(u.input_tokens*c.price.input + u.output_tokens*c.price.output) : c.reserve;
    await finish(actual>c.reserve ? 'overrun' : known ? 'completed' : 'uncertain',actual,u);
    result.generation.operationId = id;
    result.generation.cost = { currency:'USD', microUSD:actual, basis:known ? 'configured_rates_and_reported_tokens' : 'reserved_upper_bound', invoiceVerified:false };
    return result;
  } catch (error) {
    // Never refund an attempted request whose billing outcome is unknown.
    await db.prepare("UPDATE ai_operations SET state=?,charged_micro=?,finished_at=? WHERE id=? AND state='running'").bind(sent ? 'uncertain' : 'cancelled',sent ? c.reserve : 0,Date.now(),id).run();
    if (error instanceof AIError) throw error;
    throw new AIError('AI処理に失敗しました。実行履歴を確認してください。自動再試行は行いません', 'AI_FAILED',502);
  } finally { clearTimeout(timer); }
}
export function aiFailure(error) { return error instanceof AIError ? { error:error.message,code:error.code } : null; }
