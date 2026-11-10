import { reserveAI } from "../../../lib/ai-quota.js";
import { buildPrompt, departments } from "../../../assets/business.js";
// Cloudflare Pages Function: authorized job execution and read-only status.
// Requires existing JARVIS_DB and JARVIS_ACCESS_PASSWORD bindings.
// Explicit request only; scheduled execution is NOT enabled by this file.
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
const authError = (request, env) => {
  if (!env.JARVIS_ACCESS_PASSWORD)
    return json(
      {
        error: "Previewにアクセス用パスワードの設定が読み込まれていません",
        code: "ACCESS_SECRET_MISSING",
      },
      503,
    );
  if (request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD)
    return json(
      {
        error: "入力したパスワードとPreview設定が一致しません",
        code: "PASSWORD_MISMATCH",
      },
      401,
    );
  return null;
};
async function createDraft(env, prompt) {
  const provider = String(env.AI_PROVIDER || "anthropic").toLowerCase();
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OpenAI API未設定");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error("OpenAI API HTTP " + response.status);
    return data.choices?.[0]?.message?.content || "";
  }
  if (provider !== "anthropic") throw new Error("AI_PROVIDERが不正です");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error("AI provider HTTP " + response.status);
  return (data.content || [])
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n");
}
export async function onRequestGet({ request, env }) {
  const denied = authError(request, env);
  if (denied) return denied;
  if (!env.JARVIS_DB) return json({ error: "D1未接続" }, 503);
  try {
    const result = await env.JARVIS_DB.prepare(
      "SELECT id,job_type,topic,status,output,error,created_at,updated_at FROM business_jobs ORDER BY created_at DESC LIMIT 20",
    ).all();
    return json({ jobs: result.results || [] });
  } catch {
    return json(
      { error: "D1テーブル未作成、または読み込みに失敗しました" },
      503,
    );
  }
}
export async function onRequestPost({ request, env }) {
  const denied = authError(request, env);
  if (denied) return denied;
  if (!env.JARVIS_DB) return json({ error: "D1未接続" }, 503);
  const provider = String(env.AI_PROVIDER || "anthropic").toLowerCase();
  if (!["anthropic", "openai"].includes(provider))
    return json({ error: "AI_PROVIDER設定が不正です" }, 503);
  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY)
    return json({ error: "Claude API未設定" }, 503);
  if (provider === "openai" && !env.OPENAI_API_KEY)
    return json({ error: "OpenAI API未設定" }, 503);
  let id = null;
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON形式が不正です" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "入力形式が不正です" }, 400);
    const topic = String(body.topic || "初心者向けAI活用").trim();
    if (!topic || topic.length > 160)
      return json({ error: "テーマは1〜160文字で入力してください" }, 400);
    const department = body.department || "content";
    if (!Object.hasOwn(departments, department))
      return json({ error: "部門が不正です" }, 400);
    for (const field of ["audience", "format", "notes", "context"]) {
      if (
        body[field] !== undefined &&
        (typeof body[field] !== "string" ||
          body[field].length >
            { audience: 160, format: 80, notes: 2500, context: 3500 }[field])
      )
        return json({ error: "入力が長すぎるか形式が不正です" }, 400);
    }
    const prompt = buildPrompt(
      department,
      { ...body, topic },
      body.context || "",
    );
    if (prompt.length > 6000)
      return json(
        { error: "指示が6000文字を超えます。メモや選択資料を減らしてください" },
        400,
      );
    if (!(await reserveAI(env, "job")))
      return json(
        { error: "本日のAI利用上限（全体10回・記事5回・UTC・失敗含む）です" },
        429,
      );
    // Daily cost guardrail (UTC): maximum five attempted generations.
    id = crypto.randomUUID();
    const reservation = await env.JARVIS_DB.prepare(
      "INSERT INTO business_jobs(id,job_type,topic,status) SELECT ?,?,?,'running' WHERE (SELECT COUNT(*) FROM business_jobs WHERE created_at >= date('now') AND created_at < date('now','+1 day')) < 5",
    )
      .bind(id, department + "_draft", topic)
      .run();
    if (!reservation.meta?.changes) {
      id = null;
      return json({ error: "本日の生成上限（5件）に達しました" }, 429);
    }
    const answer = await createDraft(env, prompt);
    const evidence = body.context || "";
    const output =
      answer && evidence.startsWith("【RESEARCH ")
        ? answer + "\n\n--- 入力された調査資料（内容は要確認） ---\n" + evidence
        : answer;
    if (!output) throw new Error("empty response");
    await env.JARVIS_DB.prepare(
      "UPDATE business_jobs SET status='draft',output=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(output, id)
      .run();
    return json({ id, status: "draft", output }, 201);
  } catch (error) {
    if (id) {
      try {
        await env.JARVIS_DB.prepare(
          "UPDATE business_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
          .bind("生成に失敗しました。API設定や残高を確認してください。", id)
          .run();
      } catch {}
    }
    return json(
      {
        error: "処理に失敗しました。D1の設定やAI APIの残高を確認してください。",
      },
      503,
    );
  }
}
