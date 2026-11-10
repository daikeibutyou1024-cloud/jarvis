import {
  sourceCatalog,
  referenceUrl,
  manualRecord,
  importRecords,
  researchPacket,
} from "./research-data.js";
const STORE = "jarvis_research_records_v2",
  HANDOFF = "jarvis_research_handoff_v2";
export function initResearch({ request, navigate, say, brief, write, read }) {
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
  handoff = Array.isArray(handoff) ? handoff.filter(valid).slice(0, 5) : [];
  function save(next) {
    if (next.length > 100) {
      say("資料は100件までです。不要な資料を削除してから保存してください");
      return false;
    }
    if (!write(STORE, next)) return false;
    records = next;
    render();
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
      article.append(label, tag, text, compare, source, meta, del);
      root.append(article);
    }
  }
  function renderHandoff() {
    const root = $("content-evidence-list");
    root.replaceChildren();
    for (const r of handoff) {
      const li = document.createElement("li");
      li.textContent = `${r.title} / ${type(r)} / 取得：${r.fetchedAt || "未取得"}`;
      if (r.sourceUrl) li.append(" ", link(r.sourceUrl, "出典"));
      root.append(li);
    }
    $("content-evidence-empty").hidden = handoff.length > 0;
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
  $("research-to-content").onclick = () => {
    try {
      const chosen = records.filter((r) => selected.has(r.id));
      if (!chosen.length) throw Error("CONTENTに渡す資料を選択してください");
      researchPacket(chosen);
      if (!write(HANDOFF, chosen)) return;
      handoff = structuredClone(chosen);
      renderHandoff();
      navigate("content");
      say(
        "選択資料をCONTENTへ引き継ぎました。形式を選び「AIで作成」で記事下書きを生成できます。",
      );
    } catch (error) {
      say(error.message);
    }
  };
  $("content-evidence-clear").onclick = () => {
    if (write(HANDOFF, [])) {
      handoff = [];
      renderHandoff();
      say("CONTENTへの資料引き継ぎを解除しました");
    }
  };
  render();
  renderHandoff();
  return {
    context(dept) {
      if (dept === "research")
        return researchPacket(records.filter((r) => selected.has(r.id)));
      if (dept === "content" && handoff.length) return researchPacket(handoff);
      return "";
    },
  };
}
