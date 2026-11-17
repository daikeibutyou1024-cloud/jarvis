export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "POST only" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    const accessPassword = process.env.JARVIS_ACCESS_PASSWORD;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!accessPassword || !apiKey) {
      return new Response(
        JSON.stringify({ error: "サーバー設定が未完了です" }),
        { status: 500, headers }
      );
    }

    if (
      req.headers.get("x-jarvis-password") !== accessPassword
    ) {
      return new Response(
        JSON.stringify({ error: "パスワードが違います" }),
        { status: 401, headers }
      );
    }

    const body = await req.json();
    const prompt = String(body.prompt || "").trim();

    if (!prompt || prompt.length > 6000) {
      return new Response(
        JSON.stringify({
          error: "指示は1〜6000文字で入力してください"
        }),
        { status: 400, headers }
      );
    }

    const response = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          messages: [
            { role: "user", content: prompt }
          ]
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Claude APIエラー",
          detail: result.error?.message || "応答を取得できませんでした"
        }),
        { status: 502, headers }
      );
    }

    const answer = (result.content || [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n");

    return new Response(
      JSON.stringify({ answer }),
      { status: 200, headers }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "通信に失敗しました。設定を確認してください。" }),
      { status: 500, headers }
    );
  }
};
