import type { Control, FillPlan, PlanIssue } from "../types.ts";
import { appsumoSchema } from "../schema.ts";
import { buildPlan, type PlanDraft } from "../plan.ts";
import { charLength, isFullDay, isHttpUrl, issue, paragraphs, wordCount } from "../util.ts";

export interface AppSumoTier {
  name: string;
  price: number;
  originalPrice?: number;
  recommended?: boolean;
}

export interface AppSumoFeatureRow {
  label: string;
  values: string[];
  tooltip?: string;
}

export interface AppSumoPack {
  product: {
    name: string;
    category: string;
    subcategory: string;
    alternativeTo: string[];
    integrations?: string[];
    bestFor: string[];
  };
  story: {
    tagline: string;
    usp: string;
    intro: string;
    tldr: string[];
    features: {
      sectionHeader: string;
      stories: { title: string; bullets: string[] }[];
    };
  };
  pricing: {
    model: "codes" | "licensing";
    tiers: AppSumoTier[];
    features: AppSumoFeatureRow[];
  };
  company: {
    headline: string;
    narrative: string;
    founder: { name: string; role?: string; linkedinUrl?: string };
    founded: string;
    headquarters: string;
    teamSize: string;
    stage: string;
    funding: string;
  };
  faqs: { question: string; answer: string }[];
  links?: { label: string; url: string }[];
  fulfillment: {
    supportEmail: string;
    instructions: string[];
    redeemUrl?: string;
    webhookUrl?: string;
    redirectUrl?: string;
  };
  media?: {
    heroAlt?: string;
    galleryAlts?: string[];
  };
  trustSignals?: Record<string, string>;
  attestations?: { submitForReview?: boolean };
}

const BANNED = ((appsumoSchema.rules?.voice as { banned?: string[] } | undefined)?.banned ?? []);

export function prepareAppSumoPack(pack: AppSumoPack): AppSumoPack {
  const next = structuredClone(pack);
  if (Array.isArray(next.fulfillment?.instructions)) {
    next.fulfillment.instructions = next.fulfillment.instructions
      .map((step, index) => `${index + 1}. ${step.trim()}`)
      .join("\n") as unknown as string[];
  }
  return next;
}

export function assessAppSumo(pack: AppSumoPack, mode: "draft" | "submit" = "draft"): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const { pricing, story, company, faqs } = pack;
  if (pricing.model !== "codes" && pricing.model !== "licensing") {
    issues.push(issue("error", "pricing", "model", "Pricing model must be Codes or Licensing."));
  }
  if (pricing.tiers.length < 1 || pricing.tiers.length > 10) {
    issues.push(issue("error", "pricing", "tiers", "Pricing needs 1 to 10 tiers."));
  }
  pricing.tiers.forEach((tier, index) => {
    if (!tier.name.trim() || charLength(tier.name) > 200) {
      issues.push(issue("error", "pricing", "tier-name", `Tier ${index + 1} name must be 1 to 200 characters.`));
    }
    if (!Number.isFinite(tier.price) || tier.price < 1 || tier.price > 9999) {
      issues.push(issue("error", "pricing", "price", `Tier ${index + 1} price must be from $1 to $9,999.`));
    }
    if (tier.originalPrice != null && tier.originalPrice <= tier.price) {
      issues.push(issue("error", "pricing", "original-price", `Tier ${index + 1} original price must be higher than the deal price.`));
    }
    voice(issues, "pricing", tier.name);
  });
  const recommended = pricing.tiers.filter((tier) => tier.recommended).length;
  if (recommended > 1) issues.push(issue("error", "pricing", "recommended", "Only one tier can be marked recommended."));
  const entry = pricing.tiers[0]?.price;
  if (entry != null && entry > 49) {
    issues.push(issue("warning", "pricing", "entry-price", "The brief recommends an entry tier at $49 or less."));
  }
  if (pricing.features.length < 1 || pricing.features.length > 25) {
    issues.push(issue("error", "pricing", "feature-count", "The pricing matrix needs 1 to 25 feature rows."));
  } else if (pricing.features.length < 4) {
    issues.push(issue("warning", "pricing", "feature-count", "The brief asks for 4 to 25 pricing rows."));
  }
  pricing.features.forEach((row, index) => {
    if (!row.label.trim() || charLength(row.label) > 128) {
      issues.push(issue("error", "pricing", "feature-label", `Pricing row ${index + 1} label must be 1 to 128 characters.`));
    }
    if (row.values.length !== pricing.tiers.length) {
      issues.push(issue("error", "pricing", "feature-values", `Pricing row ${index + 1} needs one value per tier.`));
    }
    if (row.tooltip != null && charLength(row.tooltip) > 255) {
      issues.push(issue("error", "pricing", "tooltip", `Pricing row ${index + 1} tooltip must be 255 characters or fewer.`));
    }
    voice(issues, "pricing", row.label);
  });

  const features = story.features;
  if (charLength(features.sectionHeader) > 100) {
    issues.push(issue("error", "features", "header", "The feature section header must be 100 characters or fewer."));
  }
  if (features.stories.length < 2 || features.stories.length > 4) {
    issues.push(issue("error", "features", "stories", "Highlighted features need 2 to 4 stories."));
  }
  features.stories.forEach((item, index) => {
    if (charLength(item.title) > 100) issues.push(issue("error", "features", "title", `Story ${index + 1} title must be 100 characters or fewer.`));
    if (item.bullets.length < 2 || item.bullets.length > 5) {
      issues.push(issue("error", "features", "bullets", `Story ${index + 1} needs 2 to 5 bullets.`));
    }
    item.bullets.forEach((bullet) => {
      if (charLength(bullet) > 500) issues.push(issue("error", "features", "bullet", `A bullet in story ${index + 1} is over 500 characters.`));
      voice(issues, "features", bullet);
    });
    voice(issues, "features", item.title);
  });
  voice(issues, "features", features.sectionHeader);

  const storyParts = paragraphs(company.narrative);
  if (storyParts.length < 2) {
    issues.push(issue("error", "narrative", "paragraphs", "Founder narrative needs at least two paragraphs."));
  }
  storyParts.forEach((part, index) => {
    if (charLength(part) > 3000) issues.push(issue("error", "narrative", "paragraph-length", `Founder paragraph ${index + 1} is over 3000 characters.`));
  });
  voice(issues, "narrative", company.narrative);
  voice(issues, "headline", company.headline);
  voice(issues, "tagline", story.tagline);
  voice(issues, "usp", story.usp);
  voice(issues, "intro", story.intro);
  story.tldr.forEach((line) => voice(issues, "tldr", line));
  if (company.headquarters.trim().toLowerCase() === "remote") {
    issues.push(issue("error", "headquarters", "remote", "Headquarters is a city or country from the list, not Remote."));
  }
  if (company.founded && !isFullDay(company.founded)) {
    issues.push(issue("error", "founded", "date", "Founded must be a full day, YYYY-MM-DD."));
  }

  if (faqs.length < 1) issues.push(issue("error", "faqs", "min-items", "Add at least one FAQ."));
  if (faqs.length < 6 || faqs.length > 8) {
    issues.push(issue("warning", "faqs", "count", "The brief recommends 6 to 8 FAQ pairs."));
  }
  faqs.forEach((faq, index) => {
    if (charLength(faq.question) > 255) issues.push(issue("error", "faqs", "question", `FAQ ${index + 1} question is over 255 characters.`));
    const sentences = faq.answer.split(/[.?!]+/).map((part) => part.trim()).filter(Boolean);
    if (sentences.length > 2) issues.push(issue("warning", "faqs", "sentences", `FAQ ${index + 1} answer should stay under two sentences.`));
    voice(issues, "faqs", `${faq.question} ${faq.answer}`);
  });

  for (const link of pack.links ?? []) {
    if (charLength(link.label) > 64) issues.push(issue("error", "links", "label", "A helpful link label must be 64 characters or fewer."));
    if (charLength(link.url) > 200 || !isHttpUrl(link.url)) {
      issues.push(issue("error", "links", "url", "A helpful link must be an http(s) URL of 200 characters or fewer."));
    }
  }
  if (pack.media?.heroAlt && charLength(pack.media.heroAlt) > 255) {
    issues.push(issue("error", "hero", "alt", "Hero alt text must be 255 characters or fewer."));
  }
  if (pack.trustSignals && Object.keys(pack.trustSignals).length) {
    issues.push(issue("warning", "trust", "manual", "Trust signals stay in the editor. Paste the real URLs yourself."));
  }
  if (pricing.model === "codes") {
    issues.push(issue("warning", "pricing", "codes-file", "Attach the redemption codes CSV yourself. The shim does not read or store codes."));
    if (mode === "submit" && !pack.fulfillment.redeemUrl) {
      issues.push(issue("error", "redeemUrl", "required", "A codes deal needs a redemption URL."));
    }
  }
  if (pricing.model === "licensing" && mode === "submit") {
    if (!pack.fulfillment.webhookUrl) issues.push(issue("error", "webhookUrl", "required", "A licensing deal needs a webhook URL."));
    if (!pack.fulfillment.redirectUrl) issues.push(issue("error", "redirectUrl", "required", "A licensing deal needs a redirect URL."));
  }
  for (const [fieldId, value] of [
    ["webhookUrl", pack.fulfillment.webhookUrl],
    ["redirectUrl", pack.fulfillment.redirectUrl],
    ["redeemUrl", pack.fulfillment.redeemUrl],
  ] as const) {
    if (value && !isHttpUrl(value)) issues.push(issue("error", fieldId, "url", `${fieldId} must be an http(s) URL.`));
  }
  if (mode === "submit") {
    if (!pack.story.tldr || pack.story.tldr.length !== 2) {
      issues.push(issue("error", "tldr", "count", "TL;DR needs exactly two bullets."));
    }
    pack.story.tldr?.forEach((line, index) => {
      if (wordCount(line) < 3) issues.push(issue("error", "tldr", "item-words", `TL;DR item ${index + 1} needs at least 3 words.`));
    });
  }
  return issues;
}

export function planAppSumo(doc: Document, pack: AppSumoPack, pageUrl = "about:blank"): FillPlan {
  const prepared = prepareAppSumoPack(pack);
  const plan = buildPlan({
    schema: appsumoSchema,
    document: doc,
    pack: prepared as unknown as Record<string, unknown>,
    pageUrl,
    extraIssues: assessAppSumo(pack, "draft"),
    onUnmapped: (control, draft) => onAppSumoUnmapped(control, draft),
    after: (draft) => appsumoAfter(draft, pack),
  });
  return plan;
}

export function renderListingPaste(pack: AppSumoPack): { markdown: string; issues: PlanIssue[] } {
  const issues = assessAppSumo(pack, "submit");
  const { product, story, pricing, company, faqs } = pack;
  const gallery = story.features.stories.map((item, index) => {
    const alt = pack.media?.galleryAlts?.[index] ?? "(missing alt)";
    return `Gallery ${index + 1}: attach in the Media section, pairs with story ${index + 1}, alt: ${alt}`;
  });
  const tierLines = pricing.tiers.map((tier, index) => `Tier ${index + 1} "${tier.name}": $${tier.price}`);
  const matrix = pricing.features.map((row) => `- ${row.label}: ${row.values.join(" / ")}`);
  const tooltips = pricing.features.filter((row) => row.tooltip).map((row) => `- ${row.label}: ${row.tooltip}`);
  const redemption = [
    `Support email: ${pack.fulfillment.supportEmail}`,
    `Redemption instructions (what a buyer does after purchase): ${pack.fulfillment.instructions.join(" ")}`,
    pricing.model === "codes"
      ? `Codes: redeem URL ${pack.fulfillment.redeemUrl ?? "(missing)"}, attach the CSV in the editor`
      : `Licensing: webhook URL ${pack.fulfillment.webhookUrl ?? "(missing)"}, redirect URL ${pack.fulfillment.redirectUrl ?? "(missing)"}`,
  ];
  const markdown = [
    "## Basic information",
    `Product name: ${product.name}`,
    `Category: ${product.category} / ${product.subcategory}`,
    `Tagline: ${story.tagline}`,
    `Unique selling proposition: ${story.usp}`,
    `Intro sentence: ${story.intro}`,
    "TL;DR:",
    ...story.tldr.map((line) => `- ${line}`),
    `Alternative to: ${product.alternativeTo.join(", ")}`,
    `Integrations: ${(product.integrations ?? []).join(", ")}`,
    `Best for: ${product.bestFor.join(", ")}`,
    "",
    "## Media",
    `Hero image: attach in the Media section, alt: ${pack.media?.heroAlt ?? "(missing alt)"}`,
    ...gallery,
    "",
    "## Highlighted features",
    `Section header: ${story.features.sectionHeader}`,
    ...story.features.stories.flatMap((item, index) => [
      `### Story ${index + 1}: ${item.title}`,
      ...item.bullets.map((bullet) => `- ${bullet}`),
      `Screenshot to pair: Gallery ${index + 1}`,
    ]),
    "",
    "## Pricing",
    `Pricing model: ${pricing.model === "codes" ? "Codes" : "Licensing"}`,
    ...tierLines,
    "Feature matrix (label + per-tier value; only rows that change):",
    ...matrix,
    "Tooltips (optional, only for labels that need a definition):",
    ...(tooltips.length ? tooltips : ["- (none)"]),
    "Redemption (Pricing step 4; attach codes yourself when the model is Codes):",
    ...redemption,
    "",
    "## Product story",
    `Headline: ${company.headline}`,
    "Founder narrative:",
    company.narrative.trim(),
    `Name: ${company.founder.name}`,
    `Role: ${company.founder.role ?? ""}`,
    `Founded: ${company.founded}`,
    `Headquarters: ${company.headquarters}`,
    `Team size: ${company.teamSize}`,
    `Stage: ${company.stage}`,
    `Funding: ${company.funding}`,
    "",
    "## FAQ",
    ...faqs.flatMap((faq) => [`Q: ${faq.question}`, `A: ${faq.answer}`]),
    `Helpful links: ${(pack.links ?? []).map((link) => `${link.label}: ${link.url}`).join(", ")}`,
    "",
  ].join("\n");
  return { markdown, issues };
}

function appsumoAfter(draft: PlanDraft, pack: AppSumoPack): void {
  const shots = draft.gates.find((gate) => gate.fieldId === "screenshots");
  if (shots) shots.minFiles = Math.min(4, Math.max(1, pack.story.features.stories.length));
  const submitPresent = draft.page.controls.some((control) => control.tag === "BUTTON" && control.labels.includes("submit for review"));
  if (submitPresent && pack.attestations?.submitForReview !== true) {
    draft.errors.push(issue(
      "error",
      "submitForReview",
      "approval",
      "Submit for review stays unclicked until attestations.submitForReview is true.",
    ));
  }
  requireWhenPresent(draft, pack.pricing.model === "codes", "redeemUrl", "A codes deal needs a redemption URL.");
  requireWhenPresent(draft, pack.pricing.model === "licensing", "webhookUrl", "A licensing deal needs a webhook URL.");
  requireWhenPresent(draft, pack.pricing.model === "licensing", "redirectUrl", "A licensing deal needs a redirect URL.");
}

function requireWhenPresent(draft: PlanDraft, needed: boolean, fieldId: string, message: string): void {
  if (!needed || draft.deferred.includes(fieldId)) return;
  const wrote = draft.actions.some((item) => item.id === fieldId);
  const errored = draft.errors.some((item) => item.fieldId === fieldId);
  if (!wrote && !errored) draft.errors.push(issue("error", fieldId, "required", message));
}

function onAppSumoUnmapped(control: Control, draft: PlanDraft): void {
  if (control.disabled) return;
  const blob = control.labels.join(" ");
  if (blob.includes("private key") || blob.includes("secret") || blob.includes("g2") || blob.includes("capterra") || blob.includes("stripe") || blob.includes("company page")) {
    draft.warnings.push(issue("warning", control.id, "manual", `Left "${control.rawLabels[0] ?? "that field"}" for you to paste.`));
    return;
  }
  if (control.type === "file") {
    if (control.required) {
      draft.gates.push({
        code: "file",
        controlId: control.id,
        message: `Attach ${control.rawLabels[0] ?? "the file"} before submit.`,
      });
    }
    return;
  }
  if (control.required) {
    draft.errors.push(issue("error", control.id, "unmapped-required", `The page requires "${control.rawLabels[0]}" and the schema has no field for it.`));
  }
}

function voice(issues: PlanIssue[], fieldId: string, text: string): void {
  if (text.includes("\u2014")) issues.push(issue("warning", fieldId, "em-dash", "Replace the em dash with a comma, colon, period, or parentheses."));
  if (text.includes("!")) issues.push(issue("warning", fieldId, "exclamation", "Remove the exclamation mark."));
  if (/\p{Extended_Pictographic}/u.test(text)) issues.push(issue("warning", fieldId, "emoji", "Remove the emoji."));
  for (const word of BANNED) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
      issues.push(issue("warning", fieldId, "filler", `Remove the filler word "${word}".`));
    }
  }
}
