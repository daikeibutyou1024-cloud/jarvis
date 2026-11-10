import {
  denied,
  missing,
  responseJSON,
} from "../../../lib/research-network.js";
import { runAI, aiFailure } from "../../../lib/ai-runtime.js";
import {
  validateEvidence,
  ideaPrompt,
  validateIdeas,
} from "../../../lib/research-ideas.js";
export async function onRequestPost({ request, env }) {
  const auth = denied(request, env);
  if (auth) return auth;

  let evidence, topic, prompt;
  try {
    if (Number(request.headers.get("Content-Length")) > 50000) throw Error();
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 50000) throw Error();
    const body = JSON.parse(text);
    topic = body.topic;
    if (typeof topic !== "string" || !topic.trim() || topic.length > 160)
      throw Error();
    evidence = validateEvidence(body.records);
    prompt = ideaPrompt(topic, evidence);
    if (prompt.length > 11000) throw Error();
  } catch {
    return missing(
      "テーマと確認済み資料1〜5件を確認してください（本文は先頭700文字を分析）",
      400,
    );
  }
  try {
    const result = await runAI(env, "ideas", prompt, 3200);
    const ideas = validateIdeas(
      result.text,
      evidence,
    );
    await env.JARVIS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS research_plans (id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)",
    ).run();
    const id = crypto.randomUUID(),
      createdAt = Math.floor(Date.now() / 1000);
    await env.JARVIS_DB.prepare(
      "INSERT INTO research_plans(id,topic,payload,created_at) VALUES(?,?,?,?)",
    )
      .bind(id, topic, JSON.stringify(ideas), createdAt)
      .run();
    return responseJSON({
      ideas,
      id,
      label: "企画・全評価はAI仮説",
      createdAt: new Date(createdAt * 1000).toISOString(),
    });
  } catch (error) {
    if (aiFailure(error)) return responseJSON(aiFailure(error),error.status);
    return missing(
      "企画の生成・検証・保存に失敗しました。未取得情報を補完せず、利用回数は消費済みの場合があります",
    );
  }
}
