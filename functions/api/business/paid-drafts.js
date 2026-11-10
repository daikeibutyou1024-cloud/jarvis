import {preparePaidDraft} from "../../../lib/paid-draft.js";
import { saveRevision, revisionOf, projectId, seedLegacyPaid, latestDocument } from "../../../lib/documents.js";
import {PAID_FORMAT} from "../../../lib/paid-content.js";
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
    await revisionOf(env.JARVIS_DB, "schema-init");
    const rows = await env.JARVIS_DB.prepare(
      "SELECT p.*,(SELECT COALESCE(MAX(revision),0) FROM document_revisions WHERE project_id=p.id) AS revision FROM paid_content_drafts p ORDER BY updated_at DESC LIMIT 20",
    ).all();
    return json({
      drafts: await Promise.all((rows.results || []).map(async({generation_json,...row})=>{
        const latest=await latestDocument(env.JARVIS_DB,row.id);
        return {...row,...latest,generation:{...(latest?.generation||JSON.parse(generation_json)),document:{projectId:row.id,revision:latest?.revision??row.revision}}};
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
    const raw=await request.text();
    if(raw.length>250000)return json({error:"保存内容が大きすぎます"},400);
    const b = JSON.parse(raw);
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
    for(const [key,max] of [["audience",160],["notes",2500]])if(b[key]!==undefined&&(typeof b[key]!=="string"||b[key].length>max))return json({error:"制作条件が不正です"},400);
    await table(env);
    const id = projectId(b.id);
    const existing = await env.JARVIS_DB.prepare("SELECT * FROM paid_content_drafts WHERE id=?").bind(id).first();
    if (existing && b.expectedRevision === undefined) return json({error:"保存前に最新版を読み直してください",code:"SAVE_CONFLICT",currentRevision:await revisionOf(env.JARVIS_DB,id)},409);
    if(existing) await seedLegacyPaid(env.JARVIS_DB,id);
    const previous=await latestDocument(env.JARVIS_DB,id);
    const {output,generation}=preparePaidDraft(b,id);
    await table(env);
    const version = await saveRevision(env.JARVIS_DB,id,b.expectedRevision??0,{
      department:"content",topic:b.topic,output,evidence:b.evidence,format:PAID_FORMAT,generation,audience:b.audience??previous?.audience??generation.project.brief.audience,notes:b.notes??previous?.notes??generation.project.brief.notes,...(previous?.workflow?{workflow:previous.workflow}:{}),approved:generation.project.humanReview.status==="approved",
    },writeId=>env.JARVIS_DB.prepare(
      "INSERT INTO paid_content_drafts(id,topic,output,generation_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE write_id=?) ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,output=excluded.output,generation_json=excluded.generation_json,updated_at=CURRENT_TIMESTAMP"
    ).bind(id,b.topic,output,JSON.stringify(generation),writeId));
    generation.document=version;
    return json({ id, output, generation }, 201);
  } catch (error) {
    return json({ error: error.code==="SAVE_CONFLICT"?error.message:"有料原稿を保存できませんでした",code:error.code,currentRevision:error.currentRevision }, error.status||400);
  }
}
