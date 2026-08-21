import type {
  MediaKnowledgeConfig,
  MediaRecognitionProfile,
  MediaRecognitionTask,
} from "@myceliasdk/media.ts";

export function estimateMediaGrossUsd(
  kind: "image" | "pdf",
  pageCount: number,
  tasks: MediaRecognitionTask[],
  profile: MediaRecognitionProfile,
): number {
  if (profile.providerType !== "google-cloud") return 0;
  if (kind === "pdf") {
    if (tasks.some((task) => task !== "ocr")) {
      throw new Error("PDF imports currently support only the OCR task");
    }
    return tasks.includes("ocr") ? pageCount * 0.0015 : 0;
  }
  return (tasks.includes("visual-understanding") ? 0.006 : 0) +
    (tasks.includes("ocr") ? 0.0015 : 0) +
    (tasks.includes("labels") ? 0.0015 : 0) +
    (tasks.includes("objects") ? 0.00225 : 0);
}

export function assertMediaPerImportBudget(
  config: MediaKnowledgeConfig,
  estimatedGrossUsd: number,
): void {
  if (estimatedGrossUsd > config.promoGuard.perImportGrossLimitUsd) {
    throw new Error(
      `Import estimate $${
        estimatedGrossUsd.toFixed(4)
      } exceeds the per-import limit`,
    );
  }
}
