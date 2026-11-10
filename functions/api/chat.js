import { reserveAI } from "../../lib/ai-quota.js";
// Provider switch: Claude remains the default until its prepaid credit is used.
// Set AI_PROVIDER=openai and OPENAI_API_KEY as a Cloudflare secret when ready.
// Never expose API keys to the browser or commit them to GitHub.
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

async function askClaude(env, prompt) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEYが未設定です");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || "Claude APIエラー");
  return (result.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function askOpenAI(env, prompt) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEYが未設定です");
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
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message || "OpenAI APIエラー");
  return result.choices?.[0]?.message?.content || "";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.JARVIS_ACCESS_PASSWORD)
      return json({ error: "Cloudflareのアクセス設定が未設定です" }, 500);
    if (
      request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD
    ) {
      return json({ error: "パスワードが違います" }, 401);
    }
    const body = await request.json();
    const prompt = String(body.prompt || "").trim();
    if (!prompt || prompt.length > 6000)
      return json({ error: "指示は1〜6000文字で入力してください" }, 400);
    const provider = String(env.AI_PROVIDER || "anthropic").toLowerCase();
    if (!["anthropic", "openai"].includes(provider))
      return json({ error: "AI_PROVIDERの設定が不正です" }, 500);
    if (!env.JARVIS_DB)
      return json({ error: "AI利用回数を管理するD1が未接続です" }, 503);
    if (!(provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY))
      return json({ error: "AI APIが未設定です" }, 503);
    if (!(await reserveAI(env, "chat")))
      return json(
        { error: "本日のAI利用上限（全体10回・UTC・失敗含む）です" },
        429,
      );
    try {
      const answer =
        provider === "openai"
          ? await askOpenAI(env, prompt)
          : await askClaude(env, prompt);
      return json({ answer });
    } catch (error) {
      // Do not return raw provider errors: they can contain sensitive request details.
      console.error(
        "AI provider request failed",
        provider,
        error?.name || "Error",
      );
      return json(
        {
          error: "AI APIへの接続に失敗しました。設定や残高を確認してください。",
        },
        502,
      );
    }
  } catch (error) {
    return json({ error: "通信に失敗しました。設定を確認してください。" }, 500);
  }
}
