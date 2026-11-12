import {createDiagnostic} from '../../../lib/ai-diagnostics.js';
import {articleBody} from "../../../lib/paid-content.js";
import {storedGenerationOptions} from "../../../lib/editorial.js";
import {
  generationOptions,
  generationPrompt,
  composeResult,
  EVIDENCE_SEPARATOR,
  unknownGeneration,
} from "../../../lib/generation.js";
import { runAI, aiFailure, recoverAI, aiConfig } from "../../../lib/ai-runtime.js";
import { projectId, checkRevision, saveRevision, latestDocument } from "../../../lib/documents.js";
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
async function metadataTable(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS business_job_generations (job_id TEXT PRIMARY KEY, generation_json TEXT NOT NULL)",
    )
    .run();
}
export async function onRequestGet({ request, env }) {
  const denied = authError(request, env);
  if (denied) return denied;
  if (!env.JARVIS_DB) return json({ error: "D1未接続" }, 503);
  try {
    await recoverJobs(env.JARVIS_DB);
    await metadataTable(env.JARVIS_DB);
    const result = await env.JARVIS_DB.prepare(
      "SELECT b.id,b.job_type,b.topic,b.status,b.output,b.error,b.created_at,b.updated_at,g.generation_json FROM business_jobs b LEFT JOIN business_job_generations g ON g.job_id=b.id ORDER BY b.created_at DESC LIMIT 20",
    ).all();
    return json({
      jobs: (result.results || []).map(({ generation_json, ...job }) => {
        let generation = unknownGeneration();
        try {
          if (generation_json) generation = JSON.parse(generation_json);
        } catch {}
        return { ...job, generation };
      }),
    });
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
  let id = null, recovery = null;
  const diagnostic=createDiagnostic();
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON形式が不正です" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "入力形式が不正です" }, 400);
    let topic = String(body.topic || "初心者向けAI活用").trim();
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
    let savedDoc=null;
    if(body.useSavedDraft===true){
      const savedId=projectId(body.projectId);
      await checkRevision(env.JARVIS_DB,savedId,body.expectedRevision);
      savedDoc=await latestDocument(env.JARVIS_DB,savedId);
      if(!savedDoc)return json({error:"保存した制作案件がありません"},404);
      if(department!=="content")return json({error:"保存原稿の再開はCONTENTのみです"},400);
      if(body.topic!==savedDoc.topic||body.format!==savedDoc.format||body.context!==savedDoc.evidence||body.audience!==(savedDoc.audience||"")||body.notes!==(savedDoc.notes||""))return json({error:"制作条件が保存版と異なります。先に制作案件を保存してください"},409);
    }
    let options;
    try {
      options = savedDoc?storedGenerationOptions(body.generation,savedDoc):generationOptions(body.generation);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
    if (department !== "content" && options.mode !== "full")
      return json({ error: "章・続き生成はCONTENTのみです" }, 400);
    if (department === "content" && !savedDoc)
      options = generationOptions({
        ...options,
        title: topic,
        audience: body.audience,
        notes: body.notes,
        format: body.format || options.format,
        evidence: body.context || options.evidence,
      });
    let prompt = buildPrompt(
      department,
      { ...body, topic },
      body.context || "",
    );
    if (prompt.length > 6000)
      return json(
        { error: "指示が6000文字を超えます。メモや選択資料を減らしてください" },
        400,
      );
    const caseId = projectId(body.projectId || options.projectId);
    const expected = body.expectedRevision ?? 0;
    await checkRevision(env.JARVIS_DB,caseId,expected);
    const previousDoc=await latestDocument(env.JARVIS_DB,caseId);
    if(previousDoc?.workflow){
      if(previousDoc.format!==body.format)return json({error:"制作案件の形式は変更できません"},400);
      if(options.mode!=="full"&&options.section&&!previousDoc.workflow.outline.includes(options.section))return json({error:"保存した構成に対象章がありません"},400);
      prompt+="\n採用企画と予定構成（参考データ）："+JSON.stringify(previousDoc.workflow);
    }
    options.projectId = caseId;
    const finalPrompt = generationPrompt(prompt, options);
    if(finalPrompt.length>20000)return json({error:"生成用の構成・資料が長すぎます"},400);
    aiConfig(env,finalPrompt,2500);
    await recoverJobs(env.JARVIS_DB);
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
    await metadataTable(env.JARVIS_DB);
    const result = await runAI(env, "job", finalPrompt, 2500, id, diagnostic);
    diagnostic.stage('article_validation');
    const { body: answer, generation } = composeResult(result, options);
    const evidence = body.context || "";
    const output =
      answer && evidence.startsWith("【RESEARCH ")
        ? answer + EVIDENCE_SEPARATOR + evidence
        : answer;
    if (!output) throw new Error("empty response");
    recovery={output,generation};
    if(articleBody(output).length>60000||output.length>70000){const error=Error("生成後の本文が保存上限60000文字を超えました。元原稿は保持しています");error.code="OUTPUT_TOO_LONG";throw error;}
    recovery={output,generation};
    generation.document={projectId:caseId,revision:expected+1};
    diagnostic.stage('article_save');
    await saveRevision(env.JARVIS_DB,caseId,expected,{
      department,topic,output,evidence,format:body.format||"",audience:body.audience||"",notes:body.notes||"",...(previousDoc?.workflow?{workflow:previousDoc.workflow}:{}),generation,approved:false,
    },writeId=>[
      env.JARVIS_DB.prepare("UPDATE business_jobs SET status='draft',output=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM document_revisions WHERE write_id=?)").bind(output,id,writeId),
      env.JARVIS_DB.prepare("INSERT INTO business_job_generations(job_id,generation_json) SELECT ?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE write_id=?)").bind(id,JSON.stringify(generation),writeId),
    ],{sql:"EXISTS(SELECT 1 FROM business_jobs WHERE id=? AND status='running')",args:[id]});
    generation.diagnostic=diagnostic.finish();
    return json({ id, status: "draft", output, body: answer, generation,workflow:previousDoc?.workflow||null }, 201);
  } catch (error) {
    if(!error.diagnostic) error.diagnostic=diagnostic.finish('ARTICLE_FAILED');
    if (id) {
      try {
        await env.JARVIS_DB.prepare(
          "UPDATE business_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'",
        )
          .bind(
            error.code === "INVALID_CONTINUATION"
              ? error.message
              : "生成に失敗しました。API設定や残高を確認してください。",
            id,
          )
          .run();
      } catch {}
    }
    if (aiFailure(error)) return json(aiFailure(error),error.status);
    if(error.code==="OUTPUT_TOO_LONG")return json({error:error.message,code:error.code,diagnostic:error.diagnostic,recovery},409);
    if (error.code === "SAVE_CONFLICT") return json({error:error.message,code:error.code,diagnostic:error.diagnostic,currentRevision:error.currentRevision,recovery},409);
    if (error.code === "INVALID_CONTINUATION") {
      if (id) {
        try {
          await env.JARVIS_DB.prepare(
            "INSERT OR REPLACE INTO business_job_generations(job_id,generation_json) VALUES(?,?)",
          )
            .bind(id, JSON.stringify(error.generation))
            .run();
        } catch {}
      }
      return json(
        {
          error: error.message,
          code: error.code,
          generation: error.generation,
          diagnostic: error.diagnostic,
        },
        409,
      );
    }
    return json(
      {
        error: "処理に失敗しました。D1の設定やAI APIの残高を確認してください。",
        diagnostic: error.diagnostic,
      },
      503,
    );
  }
}

export async function recoverJobs(db) {
  await recoverAI(db);
  await db.prepare("UPDATE business_jobs SET status='failed',error='処理が中断しました。自動再試行は行いません',updated_at=CURRENT_TIMESTAMP WHERE status='running' AND (created_at<datetime('now','-120 seconds') OR id IN (SELECT job_id FROM ai_operations WHERE state='interrupted'))").run();
}
