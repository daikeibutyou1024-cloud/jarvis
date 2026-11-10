// Deterministic completeness checks are a review aid, never a quality guarantee.
export const PAID_FORMAT = "note有料記事";
export const SOURCE_MARK = "\n\n--- 管理データから作成した出典一覧 ---\n";
export const paidSections = [
  "無料部分",
  "有料部分",
  "実践手順",
  "記入済みサンプル（架空の例）",
  "完成テンプレート",
];
export function sourcesFromEvidence(evidence = "") {
  return evidence
    .split(/^(?=\[R\d+\] )/m)
    .slice(1)
    .map((block) => {
      const get = (name) =>
        block.match(new RegExp(`(?:^|\\n)${name}：([^\\n]+)`))?.[1] || "未取得";
      return {
        recordId: get("資料ID"),
        id: block.match(/^\[(R\d+)\]/)?.[1],
        title: block.split("\n")[0].replace(/^\[R\d+\] /, ""),
        url: get("出典"),
        fetchedAt: get("取得日時"),
        bodyFetchedAt: get("本文取得日時").split(" / ")[0],
        providedRange: get("AIへ提供した本文の範囲"),
        review: get("本文取得日時").split(" / ")[1] || "未確認",
      };
    });
}
export function articleBody(text) {
  return text
    .split(SOURCE_MARK)[0]
    .split("\n\n--- 入力された調査資料（内容は要確認） ---\n")[0];
}
export function inspectPaid(text, evidence = "", previous = null) {
  const body = articleBody(text);
  const sections = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  const withoutCode = body.replace(
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,
    (block) => block.replace(/[^\n]/g, " "),
  );
  const matches = [...withoutCode.matchAll(regex)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    let end = body.length;
    for (let j = i + 1; j < matches.length; j++)
      if (matches[j][1].length <= m[1].length) {
        end = matches[j].index;
        break;
      }
    sections.push({
      id: `section-${i + 1}`,
      title: m[2],
      level: m[1].length,
      text: body.slice(m.index + m[0].length, end).trim(),
    });
  }
  const sources = sourcesFromEvidence(evidence);
  const missing = [];
  const free = sections.find((s) => s.title === "無料部分"),
    paid = sections.find((s) => s.title === "有料部分");
  if (!free?.text) missing.push("無料部分の本文がありません");
  if (!paid?.text) missing.push("有料部分の本文がありません");
  if (
    free &&
    paid &&
    body.indexOf("#".repeat(free.level) + " 無料部分") >
      body.indexOf("#".repeat(paid.level) + " 有料部分")
  )
    missing.push("無料部分と有料部分の順序が逆です");
  const inPaid = (title) =>
    sections.find(
      (s) =>
        s.title.startsWith(title) &&
        paid &&
        s.level > paid.level &&
        paid.text.includes(s.text),
    );
  const procedure = inPaid("実践手順"),
    sample = inPaid("記入済みサンプル"),
    template = inPaid("完成テンプレート");
  const usable = (value) =>
    !!value &&
    !/^(?:未取得|未作成|TODO|後日|販売予定|準備中|\.\.\.|…)[。\s]*$/i.test(
      value.trim(),
    );
  const fields = (s, names) =>
    names.every(
      (name) =>
        new RegExp(`${name}[:：]\\s*([^\\n]+)`).test(s || "") &&
        usable((s || "").match(new RegExp(`${name}[:：]\\s*([^\\n]+)`))?.[1]),
    );
  const stepsOK = fields(procedure?.text, [
    "準備",
    "入力",
    "操作",
    "出力",
    "確認",
    "失敗時",
  ]);
  const sampleOK =
    !!sample &&
    /架空/.test(sample.title + sample.text) &&
    fields(sample.text, ["入力例", "出力例"]) &&
    !/入力例[:：]\s*[\[【<]/.test(sample.text);
  const code = template?.text.match(/```[^\n]*\n([\s\S]+?)\n```/);
  const templateOK =
    !!code &&
    usable(code[1]) &&
    /[\[【{].+?[\]】}]/.test(code[1]) &&
    /使い方[:：]\s*\S/.test(template.text) &&
    !/^(?:テンプレートは)?(?:販売予定|後日公開|準備中)[。\s]*$/.test(
      code[1].trim(),
    );
  if (!stepsOK)
    missing.push(
      "有料部分の実践手順：準備・入力・操作・出力・確認・失敗時を記入してください",
    );
  if (!sampleOK)
    missing.push(
      "有料部分の記入済みサンプル：架空と明示し、入力例・出力例を具体的に記入してください",
    );
  if (!templateOK)
    missing.push(
      "有料部分の完成テンプレート：入力欄付きのコピー用コードブロックと使い方が必要です（販売予定の紹介は不可）",
    );
  const cited = [
    ...new Set([...body.matchAll(/\[(R\d+)\]/g)].map((m) => m[1])),
  ];
  for (const id of cited)
    if (!sources.some((s) => s.id === id))
      missing.push(`存在しない出典番号：${id}`);
  for (const url of body.match(/https?:\/\/[^\s<>\])「」]+/g) || [])
    if (!sources.some((s) => s.url === url)) missing.push(`未登録URL：${url}`);
  if (sources.length && !cited.some((id) => sources.some((s) => s.id === id)))
    missing.push("本文に根拠資料のR番号がありません");
  if (previous?.evidence && previous.evidence !== evidence)
    missing.push("資料が変更されました。根拠と本文を再確認してください");
  return {
    version: 1,
    id: previous?.id || crypto.randomUUID(),
    format: PAID_FORMAT,
    body,
    sections,
    artifacts: { procedure: stepsOK, sample: sampleOK, template: templateOK },
    sources,
    cited,
    evidence,
    missing: [...new Set(missing)],
    status: missing.length ? "incomplete" : "needs_review",
    humanReview: { status: "pending" },
    qualityNotice:
      "形式上の欠落検査のみ。内容の正確性・実用性・引用の妥当性は人間が確認してください。",
  };
}
export function renderPaidSources(text, project) {
  return (
    articleBody(text) +
    SOURCE_MARK +
    (project.sources.length
      ? project.sources
          .map(
            (s) =>
              `[${s.id}] ${s.title}\n出典：${s.url}\n取得日時：${s.fetchedAt}\n本文取得日時：${s.bodyFetchedAt}\nAI提供範囲：${s.providedRange}\n${s.review}${project.cited.includes(s.id) ? " / 本文で参照" : " / 引き継ぎ資料（本文未参照）"}`,
          )
          .join("\n\n")
      : "出典資料は未取得。外部事実の裏付けは未確認。") +
    "\n\n" +
    project.qualityNotice
  );
}
export function paidInstructions(section = "") {
  return [
    "購入者へ渡す有料本文を作成する。販売予定テンプレートの紹介だけで代替しない。実績・体験・販売実績・価格を創作しない。記入例は実績ではなく架空の例と明示する。",
    "構造は # 記事タイトル、## 無料部分、## 有料部分、### 実践手順、### 記入済みサンプル（架空の例）、### 完成テンプレート。無料部分では価値・対象・前提と制限を説明する。",
    "実践手順には『準備：』『入力：』『操作：』『出力：』『確認：』『失敗時：』を具体的に記入。サンプルには『入力例：』『出力例：』を記入済みで示す。完成テンプレートは[入力欄]などを持つコピー用コードブロックと『使い方：』を含める。外部事実には資料の[R番号]を付ける。不足は未取得と明示する。",
    section
      ? `今回は「${section}」だけの本文を生成する。他章・記事タイトル・章見出しは出力しない。全体を完成と宣言しない。`
      : "全必須成果物を含める。出力上限なら現在の位置で止め、完成と宣言しない。",
  ].join("\n");
}
