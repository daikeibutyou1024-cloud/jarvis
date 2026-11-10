import { formats, planPacket } from "../lib/research-ideas.js";
import {
  sourceCatalog,
  referenceUrl,
  manualRecord,
  importRecords,
  researchPacket,
  handoffIsStale,
  bodyState,
} from "./research-data.js";
const STORE = "jarvis_research_records_v2",
  HANDOFF = "jarvis_research_handoff_v2";
export function initResearch({
  request,
  navigate,
  say,
  brief,
  write,
  read,
  persistBrief = () => {},
}) {
  const PLANS = "jarvis_research_plans_v3",
    PLAN_HANDOFF = "jarvis_research_plan_handoff_v3";
  let plans = read(PLANS, []),
    selectedPlan = read(PLAN_HANDOFF, null);
  if (!Array.isArray(plans)) plans = [];
  const $ = (id) => document.getElementById(id);
  let records = read(STORE, []),
    handoff = read(HANDOFF, []),
    selected = new Set(),
    collecting = false;
  const valid = (r) =>
    r &&
    typeof r.id === "string" &&
    typeof r.title === "string" &&
    typeof r.text === "string" &&
    r.title.length <= 160 &&
    r.text.length <= 1000 &&
    ["fact", "hypothesis"].includes(r.kind) &&
    (!r.sourceUrl || referenceUrl(r.sourceUrl));
  records = Array.isArray(records) ? records.filter(valid).slice(0, 100) : [];
  handoff = Array.isArray(handoff)
    ? handoff
        .filter((r) => valid(r) && r.kind === "fact" && r.reviewedAt)
        .slice(0, 5)
    : [];
  function save(next) {
    if (next.length > 100) {
      say("資料は100件までです。不要な資料を削除してから保存してください");
      return false;
    }
    if (!write(STORE, next)) return false;
    records = next;
    render();
    renderHandoff();
    return true;
  }
  function add(items) {
    const next = [...records];
    for (const item of items) {
      const index = next.findIndex(
        (r) =>
          r.origin === item.origin &&
          r.sourceUrl &&
          r.sourceUrl === item.sourceUrl,
      );
      if (index >= 0) {
        selected.delete(next[index].id);
        next[index] = item;
      } else next.push(item);
    }
    return save(next);
  }
  const type = (r) =>
    r.kind === "hypothesis"
      ? "仮説（事実ではない）"
      : r.verification === "source_observed"
        ? "出典に掲載された情報（真偽は未検証）"
        : "手入力・取り込みの事実主張（未検証）";
  function link(url, text) {
    const a = document.createElement("a");
    a.href = referenceUrl(url);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text || url;
    return a;
  }
  function render() {
    const root = $("research-records");
    root.replaceChildren();
    $("research-count").textContent =
      `${records.length}/100件・選択${selected.size}/5件`;
    if (!records.length)
      root.textContent =
        "調査資料は未取得です。収集または手入力・取り込みを行ってください。";
    for (const r of [...records].reverse()) {
      const article = document.createElement("article");
      article.className = "research-record";
      const label = document.createElement("label"),
        check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.has(r.id);
      check.setAttribute("aria-label", r.title + "を選択");
      check.onchange = () => {
        if (check.checked && selected.size >= 5) {
          check.checked = false;
          return say("資料は5件まで選択できます");
        }
        check.checked ? selected.add(r.id) : selected.delete(r.id);
        $("research-count").textContent =
          `${records.length}/100件・選択${selected.size}/5件`;
      };
      label.append(check, document.createTextNode(r.title));
      const tag = document.createElement("p");
      tag.className = "hint";
      tag.textContent = type(r);
      const text = document.createElement("p");
      text.className = "research-text";
      text.textContent = r.text;
      const meta = document.createElement("p");
      meta.className = "hint";
      meta.textContent = `取得日時：${r.fetchedAt || "未取得（手入力・AI・取り込み）"} / 記録日時：${r.recordedAt || "未取得"} / 元情報の日時：${r.publishedAt || "未取得"}`;
      const compare = document.createElement("p");
      compare.className = "hint";
      compare.textContent = `価格：${r.price || "未取得"} / アフィリエイト条件：${r.affiliate || "未取得"}`;
      const source = document.createElement("p");
      source.append(
        document.createTextNode("出典："),
        r.sourceUrl ? link(r.sourceUrl) : document.createTextNode("未取得"),
      );
      const del = document.createElement("button");
      del.textContent = "資料を削除";
      del.onclick = () => {
        if (save(records.filter((x) => x.id !== r.id))) {
          selected.delete(r.id);
          render();
          say(
            "この端末の資料を削除しました（引き継ぎ済みの資料は別途解除できます）",
          );
        }
      };
      const review = document.createElement("button");
      review.textContent = r.reviewedAt
        ? "利用者確認済み（解除）"
        : "内容・出典を確認済みにする";
      review.disabled = r.kind !== "fact";
      review.onclick = () => {
        save(
          records.map((x) =>
            x.id === r.id
              ? {
                  ...x,
                  reviewedAt: x.reviewedAt ? null : new Date().toISOString(),
                }
              : x,
          ),
        );
        say("確認は利用者の記録です。取得情報の真偽を保証しません。");
      };
      const body = document.createElement("details"),
        summary = document.createElement("summary"),
        bodyText = document.createElement("p");
      summary.textContent = r.bodyFetchedAt
        ? `本文取得済み / ${r.bodyFetchedAt}${r.bodyTruncated ? "（先頭12000文字）" : ""}`
        : `本文：未取得${r.bodyError ? " / " + r.bodyError : ""}`;
      bodyText.className = "research-text";
      bodyText.textContent =
        r.bodyText || "本文は未取得です。RSS見出しと本文を区別してください。";
      body.append(summary, bodyText);
      article.append(label, tag, text, compare, source, meta, body, review);
      if (["digital", "caa"].includes(r.origin)) {
        const get = document.createElement("button");
        get.textContent = "許可ページの本文を取得";
        get.onclick = async () => {
          get.disabled = true;
          try {
            const data = await request(
              "/api/research/article?" +
                new URLSearchParams({ url: r.sourceUrl }),
            );
            save(
              records.map((x) =>
                x.id === r.id
                  ? {
                      ...x,
                      bodyText: data.status === "acquired" ? data.text : "",
                      bodyFetchedAt: data.fetchedAt,
                      bodyTruncated: !!data.truncated,
                      bodyError: data.error || "",
                      reviewedAt: null,
                    }
                  : x,
              ),
            );
            say(
              data.status === "acquired"
                ? "本文を取得しました。内容を確認してから確認済みにしてください"
                : "本文は未取得：" + (data.error || "取得失敗"),
            );
          } catch (e) {
            save(
              records.map((x) =>
                x.id === r.id
                  ? {
                      ...x,
                      bodyText: "",
                      bodyFetchedAt: null,
                      bodyError: e.message,
                      reviewedAt: null,
                    }
                  : x,
              ),
            );
            say("本文は未取得：" + e.message);
          } finally {
            get.disabled = false;
          }
        };
        article.append(get);
      }
      article.append(del);
      root.append(article);
    }
  }
  function assertFreshHandoff() {
    const latest = read(STORE, []);
    if (handoffIsStale(handoff, Array.isArray(latest) ? latest : []))
      throw Error(
        "引き継ぎ後に資料が更新・削除されています。RESEARCHで内容を再確認し、CONTENTへ再度引き継いでください",
      );
  }
  function renderHandoff() {
    let warning = "";
    try {
      assertFreshHandoff();
    } catch (error) {
      warning = error.message;
    }
    $("content-evidence-warning").textContent = warning;
    $("content-evidence-warning").hidden = !warning;
    const root = $("content-evidence-list");
    root.replaceChildren();
    for (const r of handoff) {
      const li = document.createElement("li");
      li.textContent = `${r.title} / 本文：${bodyState(r).acquired ? "取得済み" : "未取得"} / AI提供：${bodyState(r).providedChars}文字 / 利用者確認：${r.reviewedAt || "未確認"} / ${type(r)} / 取得：${r.fetchedAt || "未取得"}`;
      if (r.sourceUrl) li.append(" ", link(r.sourceUrl, "出典"));
      root.append(li);
    }
    $("content-evidence-empty").hidden = handoff.length > 0;
    $("content-plan").textContent = selectedPlan
      ? planPacket(selectedPlan)
      : "選択企画は未取得です。RESEARCHで企画を選べます。";
  }
  $("research-form").onsubmit = async (e) => {
    e.preventDefault();
    if (collecting) return;
    collecting = true;
    const button = $("research-collect");
    button.disabled = true;
    const source = $("research-source").value,
      query = $("research-query").value.trim();
    $("research-status").textContent = "取得中…（無料の公式情報のみ）";
    try {
      const data = await request(
        "/api/research/collect?" + new URLSearchParams({ source, q: query }),
      );
      $("research-status").textContent =
        `${sourceCatalog[source].name} / キーワード：${query} / ${data.label} / ${data.cached ? "キャッシュ" : "今回の取得"} / 取得日時：${data.fetchedAt || "未取得"}${data.error ? " / " + data.error : ""}`;
      $("research-scope").textContent = data.scope || "";
      if (
        data.status === "acquired" &&
        Array.isArray(data.items) &&
        data.items.every(valid)
      ) {
        if (add(data.items))
          say(
            `${sourceCatalog[source].name}の資料を${data.items.length}件記録しました`,
          );
      } else say(data.error || "未取得です");
    } catch (error) {
      $("research-status").textContent = "未取得：" + error.message;
      $("research-scope").textContent =
        "以前に保存した資料は残りますが、今回の取得成功とは扱いません。";
      say(error.message);
    } finally {
      collecting = false;
      button.disabled = false;
    }
  };
  $("research-manual-form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const row = Object.fromEntries(new FormData(e.currentTarget));
      if (add([manualRecord(row)])) {
        e.currentTarget.reset();
        say("手入力資料を未検証として保存しました");
      }
    } catch (error) {
      say(error.message);
    }
  };
  $("research-import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw Error("取り込みは100KB以下です");
      if (!/\.(csv|json)$/i.test(file.name))
        throw Error("JSONまたはCSVを選択してください");
      const items = importRecords(
        await file.text(),
        /\.csv$/i.test(file.name) ? "csv" : "json",
      );
      if (add(items))
        say(
          `${items.length}件の資料を取り込みました。取得日時は未取得・内容は未検証として扱います。`,
        );
    } catch (error) {
      say("取り込み失敗：" + error.message);
    } finally {
      e.target.value = "";
    }
  };
  $("research-template").onclick = () => {
    download(
      "research-template.csv",
      "title,text,sourceUrl,kind,price,affiliate\n商品名,公式ページで利用者が確認した仕様,https://example.com/product,fact,未取得,未取得\n",
      "text/csv;charset=utf-8",
    );
  };
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("research-export").onclick = () =>
    download(
      "jarvis-research.json",
      JSON.stringify(records, null, 2),
      "application/json",
    );
  $("research-ai-save").onclick = () => {
    try {
      const text = $("output").value.trim();
      if (!text) throw Error("AI結果または分析メモを先に作成してください");
      if (text.length > 1000)
        throw Error(
          "仮説の記録は1000文字までです。手入力フォームで要点を整理してください",
        );
      if (
        add([
          manualRecord(
            { title: brief().topic || "AI分析メモ", text, kind: "hypothesis" },
            "ai",
          ),
        ])
      )
        say("分析結果を仮説として記録しました。事実へ自動昇格しません。");
    } catch (error) {
      say(error.message);
    }
  };
  function sendToContent(plan = null) {
    try {
      const chosen = plan
        ? plan.sourceIds.map((id) => records.find((r) => r.id === id))
        : records.filter((r) => selected.has(r.id));
      if (
        !chosen.length ||
        chosen.some((r) => !r || r.kind !== "fact" || !r.reviewedAt)
      )
        throw Error(
          "CONTENTには利用者が確認済みの事実資料だけを渡せます。資料を確認してください",
        );
      if (
        plan &&
        chosen.some(
          (r) =>
            !plan.evidence.some(
              (e) => e.id === r.id && e.reviewedAt === r.reviewedAt,
            ),
        )
      )
        throw Error("資料が更新されています。再確認・再提案してください");
      const packet =
        researchPacket(chosen) + (plan ? "\n" + planPacket(plan) : "");
      if (packet.length > 3500)
        throw Error("資料と企画が3500文字を超えます。資料を短くしてください");
      if (!write(HANDOFF, chosen) || !write(PLAN_HANDOFF, plan)) return;
      handoff = structuredClone(chosen);
      selectedPlan = plan;
      renderHandoff();
      navigate("content");
      if (plan) {
        $("topic").value = plan.title;
        $("format").value = {
          note_free: "note無料記事",
          note_paid: "note有料記事",
          affiliate: "アフィリエイト比較記事",
        }[plan.format];
      }
      persistBrief();
      say(
        "確認済み資料と企画をCONTENTへ引き継ぎました。下書き生成はAPI利用回数を消費します。",
      );
    } catch (error) {
      say(error.message);
    }
  }
  $("research-to-content").onclick = () => sendToContent();
  function renderPlans() {
    const root = $("research-plans");
    root.replaceChildren();
    if (!plans.length)
      root.textContent =
        "企画は未取得です。確認済み資料を選んで提案してください。";
    const labels = {
      demand: "読者需要",
      differentiation: "競合との差別化",
      monetization: "収益化の可能性",
      evidence: "根拠の充実度",
    };
    for (const plan of plans) {
      if (!plan || !plan.scores || !Array.isArray(plan.sourceIds)) continue;
      const card = document.createElement("article");
      card.className = "research-record";
      const title = document.createElement("h3");
      title.textContent = plan.title + " / AI仮説";
      const prose = document.createElement("p");
      prose.textContent = `${formats[plan.format]} / ${plan.reader} / ${plan.angle} / ${plan.reason}`;
      const ul = document.createElement("ul");
      for (const [key, label] of Object.entries(labels)) {
        const li = document.createElement("li");
        li.textContent = `${label}：${plan.scores[key]?.score}/5（AI仮説・実測ではない） / ${plan.scores[key]?.reason || "未取得"}`;
        ul.append(li);
      }
      const refs = document.createElement("p");
      refs.className = "hint";
      refs.textContent = `根拠資料${plan.sourceIds.length}件 / ${plan.createdAt} / 価格・売上・報酬額・実測需要は未取得`;
      const b = document.createElement("button");
      b.textContent = "この企画と確認済み資料でCONTENTへ";
      b.onclick = () => sendToContent(plan);
      card.append(title, prose, ul, refs, b);
      root.append(card);
    }
  }
  $("research-propose").onclick = async () => {
    const button = $("research-propose");
    button.disabled = true;
    try {
      const chosen = records.filter((r) => selected.has(r.id));
      if (
        !chosen.length ||
        chosen.some((r) => r.kind !== "fact" || !r.reviewedAt)
      )
        throw Error("利用者確認済みの事実資料を1〜5件選択してください");
      const topic = brief().topic;
      if (!topic) throw Error("制作ブリーフにテーマを入力してください");
      const data = await request("/api/research/ideas", "POST", {
        topic,
        records: chosen.map((r) => ({
          ...r,
          bodyText: (r.bodyText || "").slice(0, 700),
        })),
      });
      if (!Array.isArray(data.ideas))
        throw Error(data.error || "企画は未取得です");
      if (write(PLANS, data.ideas)) {
        plans = data.ideas;
        renderPlans();
        say("企画を生成しました。全評価はAI仮説であり収益を保証しません。");
      }
    } catch (error) {
      say("企画は未取得：" + error.message);
    } finally {
      button.disabled = false;
    }
  };
  $("content-evidence-clear").onclick = () => {
    if (write(HANDOFF, [])) {
      handoff = [];
      selectedPlan = null;
      write(PLAN_HANDOFF, null);
      renderHandoff();
      say("CONTENTへの資料引き継ぎを解除しました");
    }
  };
  window.addEventListener("storage", (event) => {
    if (event.key === STORE) {
      const latest = read(STORE, []);
      if (Array.isArray(latest)) records = latest.filter(valid).slice(0, 100);
      render();
      renderHandoff();
    }
  });
  render();
  renderHandoff();
  renderPlans();
  return {
    snapshot(){return {evidence:this.context("content"),idea:selectedPlan?planPacket(selectedPlan):""};},
    context(dept) {
      if (dept === "research")
        return researchPacket(records.filter((r) => selected.has(r.id)));
      if (dept === "content" && handoff.length) {
        assertFreshHandoff();
        const packet =
          researchPacket(handoff) +
          (selectedPlan ? "\n" + planPacket(selectedPlan) : "");
        if (packet.length > 3500)
          throw Error("企画・資料が3500文字を超えています");
        return packet;
      }
      return "";
    },
  };
}
