import { normalizeImageVariantCount } from "./quality";

const conceptDirections = [
  {
    key: "hero",
    instruction:
      "Concept direction: clean hero composition. Use an eye-level three-quarter camera angle, one clear visual subject, restrained clinical background, crisp studio-like lighting, and generous negative space for later RTL headline placement.",
  },
  {
    key: "workflow",
    instruction:
      "Concept direction: real clinical workflow. Use a medium-wide documentary composition in a professional rehabilitation or clinic setting, show the intended professional audience interacting naturally with the use context, and keep the conceptual equipment secondary rather than inventing product details.",
  },
  {
    key: "educational",
    instruction:
      "Concept direction: educational detail. Use a close-up or top-down composition focused on the verified use case, accessories only when grounded, clean explanatory spacing, soft even lighting, and a composition suitable for benefit labels added later by the app.",
  },
  {
    key: "campaign",
    instruction:
      "Concept direction: premium campaign visual. Use a wider environmental composition, stronger depth and lighting contrast, a confident B2B advertising feel, and a distinct negative-space zone for later brand and CTA overlay without rendering any text in the image.",
  },
] as const;

export type ImageConceptPrompt = {
  key: (typeof conceptDirections)[number]["key"];
  prompt: string;
};

export function buildImageConceptPrompts(
  basePrompt: string,
  requestedCount: string | number | null | undefined,
): ImageConceptPrompt[] {
  const count = normalizeImageVariantCount(
    typeof requestedCount === "number" ? String(requestedCount) : requestedCount,
  );
  const base = basePrompt.trim();
  return conceptDirections.slice(0, count).map((direction, index) => ({
    key: direction.key,
    prompt: [
      base,
      direction.instruction,
      `This is concept ${index + 1} of ${count}; make it visibly different from the other directions in framing, scene and camera language.`,
      "Do not render Persian text or claim this conceptual scene is a photograph of the actual product.",
    ].join("\n"),
  }));
}
