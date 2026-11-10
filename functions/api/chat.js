import {
  generationOptions,
  generationPrompt,
  composeResult,
} from "../../lib/generation.js";
import { runAI, aiFailure } from "../../lib/ai-runtime.js";
// Provider switch: Claude remains the default until its prepaid credit is used.
// Set AI_PROVIDER=openai and OPENAI_API_KEY as a Cloudflare secret when ready.
// Never expose API keys to the browser or commit them to GitHub.
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

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
    let options;
    try {
      options = generationOptions(body.generation);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
    let finalPrompt;
    try {
      finalPrompt = generationPrompt(prompt, options);
    } catch (error) {
      if (error.code === "INVALID_CONTINUATION")
        return json({ error: error.message, code: error.code }, 409);
      throw error;
    }
    const provider = String(env.AI_PROVIDER || "anthropic").toLowerCase();
    if (!["anthropic", "openai"].includes(provider))
      return json({ error: "AI_PROVIDERの設定が不正です" }, 500);
    if (!env.JARVIS_DB)
      return json({ error: "AI利用回数を管理するD1が未接続です" }, 503);
    if (!(provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY))
      return json({ error: "AI APIが未設定です" }, 503);
    try {
      const answer = await runAI(env, "chat", finalPrompt, 4000);
      const { body: article, generation } = composeResult(answer, options);
      return json({ answer: article, generation });
    } catch (error) {
      if (aiFailure(error)) return json(aiFailure(error), error.status);
      if (error.code === "INVALID_CONTINUATION")
        return json(
          {
            error: error.message,
            code: error.code,
            generation: error.generation,
          },
          409,
        );
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
