import { inspectPaid, articleBody, paidSections } from "./paid-content.js";
import {
  normalized,
  headings,
  validatedContinuation,
  ContinuationError,
} from "./continuation.js";
const key = (s) => normalized(s.replace(/[*_`]/g, ""));
const artifactKeys = {
  実践手順: "procedure",
  "記入済みサンプル（架空の例）": "sample",
  完成テンプレート: "template",
};
export function chapterPlan(previous, section, continuation = false) {
  const body = articleBody(previous),
    p = inspectPaid(body);
  const candidates = p.sections.filter((s) => key(s.title) === key(section));
  if (candidates.length > 1)
    throw new ContinuationError(
      "対象章が複数あります。原稿の構成を確認してください",
    );
  const target = candidates[0];
  if (
    !continuation &&
    target &&
    (artifactKeys[section] ? p.artifacts[artifactKeys[section]] : !!target.text)
  )
    throw new ContinuationError(
      "指定章は既に記入済みです。再生成せず内容を確認してください",
    );
  if (continuation && !target)
    throw new ContinuationError("続きの対象章がありません");
  const level = ["無料部分", "有料部分"].includes(section) ? 2 : 3;
  const paid = p.sections.filter((s) => s.title === "有料部分");
  if (
    level === 3 &&
    (paid.length !== 1 ||
      (target && !(target.start > paid[0].start && target.end <= paid[0].end)))
  )
    throw new ContinuationError(
      "成果物の追記先となる有料部分を一つ用意してください",
    );
  const boundary = target?.end ?? (level === 3 ? paid[0].end : body.length);
  const at = body.slice(0, boundary).trimEnd().length;
  return {
    body,
    target,
    at,
    level,
    context: body.slice(0, at),
    suffix: body.slice(at),
  };
}
export function composePaidChapter(
  previous,
  candidate,
  options,
  continuation = false,
) {
  const plan = chapterPlan(previous, options.section, continuation);
  let part = candidate,
    removedHeading = false;
  // Accept exactly one leading requested heading, then let the application own it.
  if (!continuation) {
    const first = part.match(/^\s*#{1,6}[ \t]+([^\n]+)\r?\n/);
    if (first && key(first[1].trim()) === key(options.section)) {
      part = part.slice(first[0].length);
      removedHeading = true;
    }
  }
  const after = headings(part);
  for (const h of after) {
    if (
      paidSections.some((s) => key(s) === h.key) ||
      (!continuation && h.level <= plan.level)
    )
      throw new ContinuationError("対象外の章・章見出しの二重生成");
    if (
      !continuation &&
      plan.target &&
      headings(plan.target.text).some((old) => old.key === h.key)
    )
      throw new ContinuationError("対象章内の既出見出しへの逆戻り");
  }
  const policy = continuation ? {} : { localHeadingLevel: plan.level };
  const boundaryCheck = validatedContinuation(
    plan.context,
    part,
    options,
    policy,
  );
  const fullCheck = validatedContinuation(
    plan.body,
    boundaryCheck.text,
    options,
    policy,
  );
  const checked = {
    text: fullCheck.text,
    validation: {
      ...fullCheck.validation,
      removedExactBoundaryCharacters:
        boundaryCheck.validation.removedExactBoundaryCharacters +
        fullCheck.validation.removedExactBoundaryCharacters,
    },
  };
  const prefix = plan.target
    ? ""
    : `${"#".repeat(plan.level)} ${options.section}\n`;
  // No replacement or deletion: insert into the target's end before subsequent chapters.
  const body =
    (plan.body ? plan.body.slice(0, plan.at) : "# " + options.title) +
    (continuation ? "" : "\n\n" + prefix) +
    checked.text +
    (continuation ? "" : "\n\n") +
    plan.suffix;
  return {
    body,
    validation: {
      ...checked.validation,
      targetSection: options.section,
      insertedAt: plan.at,
      removedLeadingHeading: removedHeading,
      operation: plan.target ? "supplement" : "add",
    },
  };
}
