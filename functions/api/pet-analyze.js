export async function onRequestPost({ request, env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "https://asset-simulator-87y.pages.dev",
    "Vary": "Origin"
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      ...headers,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-jarvis-password"
    }});
  }
  try {
    if (!env.ANTHROPIC_API_KEY || !env.JARVIS_ACCESS_PASSWORD) {
      return new Response(JSON.stringify({ error: "Cloudflareの環境変数 ANTHROPIC_API_KEY / JARVIS_ACCESS_PASSWORD が未設定です" }), { status: 500, headers });
    }
    if (request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD) {
      return new Response(JSON.stringify({ error: "アクセスパスワードが違います" }), { status: 401, headers });
    }
    const body = await request.json();
    const frames = Array.isArray(body.frames) ? body.frames : [];
    const mood = String(body.mood || "AIにおまかせ").slice(0, 80);
    const duration = Number(body.duration);
    if (!Number.isFinite(duration) || duration <= 0 || frames.length < 3 || frames.length > 10) {
      return new Response(JSON.stringify({ error: "動画情報または解析画像が不正です（画像は3〜10枚必要です）" }), { status: 400, headers });
    }
    const revise = body.mode === "revise";
    const instruction = String(body.instruction || "").slice(0, 1200);
    const currentSegments = Array.isArray(body.currentSegments) ? body.currentSegments.slice(0, 6) : [];
    if (revise && !instruction.trim()) {
      return new Response(JSON.stringify({ error: "修正指示を入力してください" }), { status: 400, headers });
    }
    const content = [{
      type: "text",
      text: revise
        ? "あなたは犬動画専門のプロ動画編集者です。ユーザーが現在の編集案に修正指示を出しました。動画から抽出した時刻付き静止画と現在の編集案を参考に、指示に従って編集案を更新してください。動画全体の長さは " + duration.toFixed(1) + " 秒。現在の編集案: " + JSON.stringify(currentSegments) + "。ユーザーの修正指示: " + instruction + "\n" +
          "指示されていない部分はできるだけ維持してください。シーンの追加・削除・順序変更・開始終了時刻の調整・字幕変更に対応してください。画像から動きや音声は断定しないでください。\n" +
          "必ずJSONのみで返してください。形式: {\"summary\":\"更新内容の短い説明\",\"segments\":[{\"start\":数値,\"end\":数値,\"reason\":\"選定理由\",\"caption\":\"短い日本語字幕\"}],\"title\":\"動画タイトル\"}。start/endは0〜動画長の範囲内、各区間2〜12秒、最大6区間、重複禁止。"
        : "あなたは犬動画専門のプロ動画編集者です。添付画像は同じ動画から時刻順に抜き出した静止画です。各画像の時刻はラベルに記載されています。動画全体の長さは " + duration.toFixed(1) + " 秒。編集方針: " + mood + "。\n" +
          "画像から読み取れる犬の表情・姿勢・構図・かわいさ・面白さを評価し、最も見せたい区間を最大3つ選んでください。画像だけでは動きや音声は断定しないでください。\n" +
          "必ずJSONのみで返してください。形式: {\"summary\":\"日本語の短い総評\",\"segments\":[{\"start\":数値,\"end\":数値,\"reason\":\"選定理由\",\"caption\":\"短い日本語字幕\"}],\"title\":\"動画タイトル\"}。\n" +
          "start/endは画像ラベルの時刻を参考にし、動画範囲内の秒数で返す。各区間は2〜8秒、最大3区間、重複禁止。良い場面が少ない場合は1区間でよい。"
    }];
    for (const frame of frames) {
      const data = String(frame.data || "");
      const match = data.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || match[2].length > 1200000) {
        return new Response(JSON.stringify({ error: "解析画像の形式またはサイズが不正です" }), { status: 400, headers });
      }
      content.push({ type: "text", text: "動画内の時刻: " + Math.max(0, Number(frame.time) || 0).toFixed(1) + "秒" });
      content.push({ type: "image", source: { type: "base64", media_type: "image/" + match[1], data: match[2] } });
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
        max_tokens: 1600,
        messages: [{ role: "user", content }]
      })
    });
    const result = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Claude APIエラー", detail: result.error?.message || "応答を取得できませんでした" }), { status: 502, headers });
    }
    const answer = (result.content || []).filter(item => item.type === "text").map(item => item.text).join("\n");
    return new Response(JSON.stringify({ answer }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: "解析通信に失敗しました。設定を確認してください。" }), { status: 500, headers });
  }
}