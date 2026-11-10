import { budgetEnv, adaptDB, testDB } from "./runtime-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  departments,
  buildPrompt,
  financeTotals,
  metricsSummary,
} from "../assets/business.js";
import { onRequestPost, onRequestGet } from "../functions/api/business/jobs.js";
import { onRequestPost as chat } from "../functions/api/chat.js";
const request = (body = {}, password = "test") =>
  new Request("http://localhost/api/business/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-jarvis-password": password,
    },
    body: JSON.stringify(body),
  });
const env = { JARVIS_ACCESS_PASSWORD: "test", ...budgetEnv, ANTHROPIC_API_KEY: "fake" };
test("all departments use factual, draft-only instructions", () => {
  for (const d of Object.keys(departments)) {
    const prompt = buildPrompt(d, { topic: "AI", format: "X投稿" });
    assert.match(prompt, new RegExp(departments[d].name));
    assert.match(prompt, /下書きのみ/);
    assert.match(prompt, /未検証/);
  }
});
test("finance subtracts both API and other costs exactly once", () => {
  assert.deepEqual(
    financeTotals([
      { type: "revenue", amount: 10000 },
      { type: "expense", amount: 2000 },
      { type: "api", amount: 500 },
    ]),
    { revenue: 10000, expense: 2000, api: 500, profit: 7500 },
  );
  assert.equal(financeTotals([]).profit, 0);
});
test("zero denominators and unentered metrics are not invented", () => {
  assert.match(metricsSummary(), /未入力/);
  assert.match(
    metricsSummary({ period: "2026-11", visits: 0, clicks: 0, conversions: 0 }),
    /算出不可/,
  );
});
test("auth blocks jobs before database access", async () => {
  assert.equal(
    (await onRequestPost({ request: request(), env: {} })).status,
    503,
  );
  assert.equal(
    (await onRequestPost({ request: request({}, "wrong"), env })).status,
    401,
  );
  assert.equal(
    (await onRequestGet({ request: request({}, "wrong"), env })).status,
    401,
  );
});
test("existing chat auth and validation remain intact", async () => {
  assert.equal(
    (await chat({ request: request({}, "wrong"), env })).status,
    401,
  );
  assert.equal(
    (await chat({ request: request({ prompt: "" }), env })).status,
    400,
  );
});
test("jobs validate department and context before reserving a job", async () => {
  const config = {
    ...env,
    JARVIS_DB: {
      prepare() {
        throw Error("must not access");
      },
    },
  };
  assert.equal(
    (
      await onRequestPost({
        request: request({ department: "calendar" }),
        env: config,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await onRequestPost({
        request: request({ notes: "x".repeat(2501) }),
        env: config,
      })
    ).status,
    400,
  );
});
test("daily cap reserves atomically and prevents provider calls", async () => {
 const db=testDB(),original=fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error("must not call");};
 try{
  for(let i=0;i<5;i++)db.db.prepare("INSERT INTO business_jobs(id,job_type,topic,status) VALUES(?, 'content_draft','existing','draft')").run(String(i));
  const result=await onRequestPost({request:request({topic:"test"}),env:{...env,JARVIS_DB:db}});
  assert.equal(result.status,429);assert.equal(calls,0);
 }finally{globalThis.fetch=original;db.db.close();}
});
test("cloud generation preserves D1 lifecycle and both providers", async () => {
 const original=fetch;
 try{
  for(const provider of ["anthropic","openai"]){
   const db=testDB();
   globalThis.fetch=async(url,o)=>{
    assert.match(url,provider==="openai"?/api.openai.com/:/api.anthropic.com/);assert.match(o.body,/MARKETING/);
    return Response.json(provider==="openai"?{choices:[{message:{content:"安全な下書き"}}]}:{content:[{type:"text",text:"安全な下書き"}]});
   };
   const r=await onRequestPost({request:request({department:"marketing",topic:"AI"}),env:{...env,AI_PROVIDER:provider,OPENAI_API_KEY:"fake",JARVIS_DB:db}});
   assert.equal(r.status,201);const d=await r.json();assert.equal(d.output,"安全な下書き");
   const row=db.db.prepare('SELECT * FROM business_jobs').get();assert.equal(row.job_type,'marketing_draft');assert.equal(row.status,'draft');assert.equal(d.generation.document.revision,1);
   db.db.close();
  }
 }finally{globalThis.fetch=original;}
});
test("failed provider marks job failed without exposing credentials",async()=>{
 const db=testDB(),original=fetch;globalThis.fetch=async()=>Response.json({error:{message:"secret-leak"}},{status:500});
 try{
  const r=await onRequestPost({request:request({topic:"AI"}),env:{...env,JARVIS_DB:db}});
  assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/secret-leak/);
  assert.equal(db.db.prepare('SELECT status FROM business_jobs').get().status,'failed');
 }finally{globalThis.fetch=original;db.db.close();}
});

test("finance avoids fractional-yen floating point drift", () => {
  assert.equal(
    financeTotals([
      { type: "revenue", amount: 0.1 },
      { type: "revenue", amount: 0.2 },
    ]).profit,
    0.3,
  );
});
