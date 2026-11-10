import {inspectPaid,renderPaidSources,PAID_FORMAT} from "./paid-content.js";
import {canApprove,unknownGeneration} from "./generation.js";
export function preparePaidDraft(b,id) {
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
      audience: String(b.audience ?? incoming.project?.brief?.audience ?? "").slice(0, 160),
      notes: String(b.notes ?? incoming.project?.brief?.notes ?? "").slice(0, 2500),
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
    return {output,generation};

}
