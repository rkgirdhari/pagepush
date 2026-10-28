import type { Control, FillPlan, PlanIssue } from "../types.ts";
import { devpostSchema } from "../schema.ts";
import { buildPlan, type PlanDraft } from "../plan.ts";
import { clip, dedupe, issue, labelKey } from "../util.ts";

export interface DevpostQuestion {
  prompt: string;
  answer: string;
}

export interface DevpostTarget {
  url: string;
  requiresVideo?: boolean;
  questions?: DevpostQuestion[];
  acceptedTerms?: boolean;
}

export interface DevpostPack {
  project: {
    name: string;
    tagline: string;
    story?: string;
    storySections?: Partial<Record<
      "inspiration" | "whatItDoes" | "howWeBuiltIt" | "challenges" | "accomplishments" | "whatWeLearned" | "whatsNext",
      string
    >>;
    builtWith: string[];
    tryItOut?: string[];
    videoUrl?: string;
    repositoryUrl?: string;
  };
  team?: { emails?: string[] };
  hackathon?: {
    url?: string;
    requiresVideo?: boolean;
    questions?: DevpostQuestion[];
  };
  targets?: DevpostTarget[];
  attestations?: { acceptedTerms?: boolean };
}

const STORY: [keyof NonNullable<DevpostPack["project"]["storySections"]>, string][] = [
  ["inspiration", "Inspiration"],
  ["whatItDoes", "What it does"],
  ["howWeBuiltIt", "How we built it"],
  ["challenges", "Challenges we ran into"],
  ["accomplishments", "Accomplishments that we're proud of"],
  ["whatWeLearned", "What we learned"],
  ["whatsNext", "What's next"],
];

export function prepareDevpostPack(pack: DevpostPack): DevpostPack {
  const next = structuredClone(pack);
  const sections = next.project.storySections;
  const composed = sections
    ? STORY.flatMap(([key, heading]) => {
        const body = sections[key]?.trim();
        return body ? [`## ${heading}`, "", body, ""] : [];
      }).join("\n").trim()
    : "";
  next.project.story = next.project.story?.trim() || composed;
  next.project.name = next.project.name.trim();
  next.project.tagline = next.project.tagline.trim();
  next.project.builtWith = dedupe(next.project.builtWith.map((tag) => tag.trim()).filter(Boolean));
  next.project.tryItOut = next.project.tryItOut?.map((url) => url.trim()).filter(Boolean);
  next.project.videoUrl = next.project.videoUrl?.trim();
  next.project.repositoryUrl = next.project.repositoryUrl?.trim();
  next.team = { emails: (next.team?.emails ?? []).map((email) => email.trim()).filter(Boolean) };
  return next;
}

export function planDevpost(doc: Document, pack: DevpostPack, pageUrl = "about:blank"): FillPlan {
  const prepared = prepareDevpostPack(pack);
  const extra: PlanIssue[] = [];
  const rawTags = pack.project.builtWith.map((tag) => tag.trim()).filter(Boolean);
  if (new Set(rawTags.map((tag) => tag.toLowerCase())).size !== rawTags.length) {
    extra.push(issue("warning", "builtWith", "duplicate-tag", "Duplicate built-with tags were collapsed."));
  }
  return buildPlan({
    schema: devpostSchema,
    document: doc,
    pack: prepared as unknown as Record<string, unknown>,
    pageUrl,
    extraIssues: extra,
    onUnmapped: (control, draft) => onDevpostUnmapped(control, draft, prepared),
    after: (draft) => {
      const submitPresent = draft.page.controls.some((control) =>
        control.tag === "BUTTON" && control.labels.some((label) => label === "submit" || label === "submit project" || label === "submit entry"),
      );
      if (submitPresent && prepared.attestations?.acceptedTerms !== true) {
        draft.errors.push(issue(
          "error",
          "acceptedTerms",
          "terms",
          "Accept the hackathon terms in the pack before submit. The checkbox stays unchecked until you do.",
        ));
      }
      const videoOnPage = draft.page.controls.some((control) => control.labels.some((label) => label.includes("video")));
      const video = prepared.project.videoUrl ?? "";
      const videoErrored = draft.errors.some((item) => item.fieldId === "videoUrl");
      if (prepared.hackathon?.requiresVideo && videoOnPage && !video && !videoErrored) {
        draft.errors.push(issue("error", "videoUrl", "video-required", "This hackathon requires a demo video URL."));
      }
    },
  });
}

export function planDevpostSprint(pages: { url: string; document: Document }[], pack: DevpostPack): FillPlan[] {
  return pages.map((page) => {
    const target = pack.targets?.find((item) => item.url === page.url);
    return planDevpost(page.document, {
      ...pack,
      hackathon: {
        url: page.url,
        requiresVideo: target?.requiresVideo ?? pack.hackathon?.requiresVideo,
        questions: target?.questions ?? pack.hackathon?.questions,
      },
      attestations: { acceptedTerms: target?.acceptedTerms ?? false },
    }, page.url);
  });
}

function onDevpostUnmapped(control: Control, draft: PlanDraft, pack: DevpostPack): void {
  if (control.disabled) return;
  const prompt = control.rawLabels[0];
  if (!prompt) return;
  if (control.type === "file") {
    if (control.required) {
      draft.gates.push({
        code: "file",
        fieldId: `custom:${labelKey(prompt)}`,
        controlId: control.id,
        message: `Attach ${prompt} before submit.`,
      });
    }
    return;
  }
  if (control.type === "checkbox" || control.type === "radio") {
    if (control.required) {
      draft.errors.push(issue("error", `custom:${labelKey(prompt)}`, "unanswered", `This hackathon requires "${prompt}" and the pack cannot check it.`));
    }
    return;
  }
  const answer = (pack.hackathon?.questions ?? []).find((question) => labelKey(question.prompt) === labelKey(prompt));
  if (!answer) {
    if (control.required) {
      draft.errors.push(issue("error", `custom:${labelKey(prompt)}`, "unanswered", `This hackathon asks "${prompt}" and the pack has no answer.`));
    } else {
      draft.warnings.push(issue("warning", `custom:${labelKey(prompt)}`, "unmapped", `Left "${prompt}" alone.`));
    }
    return;
  }
  const value = answer.answer.trim();
  if (control.tag === "SELECT") {
    const options = Array.from(control.element.querySelectorAll("option"));
    const match = options.some((option) => labelKey(option.getAttribute("value") ?? "") === labelKey(value) || labelKey(option.textContent ?? "") === labelKey(value));
    if (!match) {
      draft.errors.push(issue("error", `custom:${labelKey(prompt)}`, "option-miss", `"${prompt}" has no option for ${value}.`));
      return;
    }
  }
  draft.matched.add(control.id);
  draft.actions.push({
    id: `custom:${labelKey(prompt)}`,
    phase: "draft",
    kind: control.tag === "SELECT" ? "select" : control.tag === "TEXTAREA" || control.editable ? "textarea" : "text",
    label: prompt,
    controlId: control.id,
    value,
    preview: `${prompt}: ${clip(value)}`,
  });
}
