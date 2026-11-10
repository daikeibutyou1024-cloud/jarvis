import {
  inspectPaid,
  renderPaidSources,
  PAID_FORMAT,
} from "../../../lib/paid-content.js";
import { canApprove, unknownGeneration } from "../../../lib/generation.js";
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function table(env) {
  await env.JARVIS_DB.prepare(
    "CREATE TABLE IF NOT EXISTS paid_content_drafts (id TEXT PRIMARY KEY, topic TEXT NOT NULL, output TEXT NOT NULL, generation_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ).run();
}
function denied(request, env) {
  if (
    !env.JARVIS_ACCESS_PASSWORD ||
    request.headers.get("x-jarvis-password") !== env.JARVIS_ACCESS_PASSWORD
  )
    return json({ error: "認証が必要です" }, 401);
  if (!env.JARVIS_DB) return json({ error: "D1未接続" }, 503);
}
export async function onRequestGet({ request, env }) {
  const error = denied(request, env);
  if (error) return error;
  try {
    await table(env);
    const rows = await env.JARVIS_DB.prepare(
      "SELECT * FROM paid_content_drafts ORDER BY updated_at DESC LIMIT 20",
    ).all();
    return json({
      drafts: (rows.results || []).map(({ generation_json, ...row }) => ({
        ...row,
        generation: JSON.parse(generation_json),
      })),
    });
  } catch {
    return json({ error: "有料原稿を読み込めませんでした" }, 503);
  }
}
export async function onRequestPost({ request, env }) {
  const error = denied(request, env);
  if (error) return error;
  try {
    const b = await request.json();
    if (
      typeof b.text !== "string" ||
      !b.text.trim() ||
      b.text.length > 60000 ||
      typeof b.topic !== "string" ||
      !b.topic.trim() ||
      b.topic.length > 160 ||
      typeof b.evidence !== "string" ||
      b.evidence.length > 3500
    )
      return json(
        { error: "原稿・テーマ・資料の形式または長さが不正です" },
        400,
      );
    const id =
      typeof b.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(b.id)
        ? b.id
        : crypto.randomUUID();
    // Recompute content requirements. Never trust client-supplied missing/approved flags.
    const project = inspectPaid(b.text, b.evidence, { id });
    const incoming = b.generation || unknownGeneration();
    const generation = {
      ...unknownGeneration(),
      format: PAID_FORMAT,
      stopReason:
        typeof incoming.stopReason === "string"
          ? incoming.stopReason.slice(0, 80)
          : "unknown",
      completionStatus: ["complete", "incomplete", "unknown"].includes(
        incoming.completionStatus,
      )
        ? incoming.completionStatus
        : "unknown",
      section:
        typeof incoming.section === "string"
          ? incoming.section.slice(0, 120)
          : "",
      mode: ["full", "chapter", "continue"].includes(incoming.mode)
        ? incoming.mode
        : "full",
      usage: incoming.usage,
      project,
      articleStatus: "incomplete",
    };
    if (b.manualComplete === true && !project.missing.length)
      generation.articleStatus = "manual_complete";
    else if (generation.completionStatus === "complete")
      generation.articleStatus = project.status;
    if (b.approved === true && canApprove(generation))
      project.humanReview = {
        status: "approved",
        at: new Date().toISOString(),
      };
    project.generationState = {
      stopReason: generation.stopReason,
      completionStatus: generation.completionStatus,
      mode: generation.mode,
      section: generation.section,
    };
    project.brief = {
      topic: b.topic,
      format: PAID_FORMAT,
      audience: String(incoming.project?.brief?.audience || "").slice(0, 160),
      notes: String(incoming.project?.brief?.notes || "").slice(0, 2500),
    };
    project.sections = project.sections.map((s) => ({
      ...s,
      generationState:
        incoming.project?.sections?.find((x) => x.title === s.title)
          ?.generationState === "complete"
          ? "complete"
          : "requires_human_review",
    }));
    const output = renderPaidSources(b.text, project);
    await table(env);
    await env.JARVIS_DB.prepare(
      "INSERT INTO paid_content_drafts(id,topic,output,generation_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,output=excluded.output,generation_json=excluded.generation_json,updated_at=CURRENT_TIMESTAMP",
    )
      .bind(id, b.topic, output, JSON.stringify(generation))
      .run();
    return json({ id, output, generation }, 201);
  } catch {
    return json({ error: "有料原稿を保存できませんでした" }, 400);
  }
}
