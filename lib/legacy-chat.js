export async function onRequestPost({ request, env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  try {
    if (!env.JARVIS_ACCESS_PASSWORD || !env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "Cloudflareの環境変数が未設定です" }), { status: 500, headers });
    }
    if (request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD) {
      return new Response(JSON.stringify({ error: "パスワードが違います" }), { status: 401, headers });
    }
    const body = await request.json();
    const prompt = String(body.prompt || "").trim();
    if (!prompt || prompt.length > 6000) {
      return new Response(JSON.stringify({ error: "指示は1〜6000文字で入力してください" }), { status: 400, headers });
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const result = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Claude APIエラー", detail: result.error?.message || "応答を取得できませんでした" }), { status: 502, headers });
    }
    const answer = (result.content || []).filter(item => item.type === "text").map(item => item.text).join("\n");
    return new Response(JSON.stringify({ answer }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: "通信に失敗しました。設定を確認してください。" }), { status: 500, headers });
  }
}