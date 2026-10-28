import type { ApplyResult, PlanIssue } from "./types.ts";
import { issue } from "./util.ts";
import { prepareDevpostPack, type DevpostPack } from "./shims/devpost.ts";
import { renderListingPaste, type AppSumoPack } from "./shims/appsumo.ts";

export function recoverListing(
  pack: AppSumoPack,
  result: Pick<ApplyResult, "unconfirmed">,
): { markdown: string; issues: PlanIssue[] } {
  const pasted = renderListingPaste(pack);
  if (result.unconfirmed.length === 0) return pasted;
  return {
    markdown: pasted.markdown,
    issues: [
      issue(
        "warning",
        "draft",
        "paste-fallback",
        `These fields did not stick. Copy them from the paste: ${result.unconfirmed.join(", ")}.`,
      ),
      ...pasted.issues,
    ],
  };
}

export function renderDevpostPaste(pack: DevpostPack): string {
  const prepared = prepareDevpostPack(pack);
  const project = prepared.project;
  return [
    `Project name: ${project.name}`,
    `Tagline: ${project.tagline}`,
    `Built with: ${project.builtWith.join(", ")}`,
    `Try it out: ${(project.tryItOut ?? []).join(", ")}`,
    `Video: ${project.videoUrl ?? ""}`,
    `Repository: ${project.repositoryUrl ?? ""}`,
    "",
    project.story ?? "",
  ].join("\n");
}
