import type { MediaKnowledgeConfig } from "@myceliasdk/media.ts";

export type PromoGuardReadiness = {
  ready: boolean;
  code?:
    | "PROMO_ACCOUNT_TYPE_NOT_VERIFIED"
    | "PROMO_CREDIT_NOT_RECENTLY_VERIFIED"
    | "PROMO_PROJECT_NOT_VERIFIED"
    | "PROMO_TERMS_NOT_VERIFIED"
    | "PROMO_BALANCE_NOT_VERIFIED"
    | "PROMO_CREDIT_WINDOW_CLOSED";
};

export function inspectPromoGuard(
  config: MediaKnowledgeConfig,
  projectId: string,
  requestedUsd: number,
  now = Date.now(),
): PromoGuardReadiness {
  const guard = config.promoGuard;
  if (
    !guard.verifiedBillingAccountType ||
    guard.verifiedBillingAccountType === "not_verified"
  ) {
    return { ready: false, code: "PROMO_ACCOUNT_TYPE_NOT_VERIFIED" };
  }
  if (guard.creditVerifiedProjectId !== projectId) {
    return { ready: false, code: "PROMO_PROJECT_NOT_VERIFIED" };
  }
  if (
    guard.creditVerifiedBillingAccountType !==
      guard.verifiedBillingAccountType
  ) {
    return { ready: false, code: "PROMO_TERMS_NOT_VERIFIED" };
  }

  // paid_with_promo is an explicit, project-bound acknowledgement that real
  // charges are acceptable. Keep the application gross-cost ledger and hard
  // limits, but do not require a promotional-balance attestation every day.
  if (guard.verifiedBillingAccountType === "paid_with_promo") {
    return { ready: true };
  }

  const verified = guard.creditVerifiedAt
    ? new Date(guard.creditVerifiedAt).getTime()
    : 0;
  const age = now - verified;
  if (!verified || age < -5 * 60 * 1000 || age > 24 * 60 * 60 * 1000) {
    return { ready: false, code: "PROMO_CREDIT_NOT_RECENTLY_VERIFIED" };
  }
  if (
    guard.creditVerifiedPromotionExpiresAt !== guard.promotionExpiresAt
  ) {
    return { ready: false, code: "PROMO_TERMS_NOT_VERIFIED" };
  }
  if (
    !Number.isFinite(guard.verifiedRemainingUsd) ||
    Number(guard.verifiedRemainingUsd) < requestedUsd
  ) {
    return { ready: false, code: "PROMO_BALANCE_NOT_VERIFIED" };
  }
  const stopAt = new Date(guard.promotionExpiresAt ?? "").getTime() -
    guard.stopBeforeHours * 60 * 60 * 1000;
  if (!Number.isFinite(stopAt) || now >= stopAt) {
    return { ready: false, code: "PROMO_CREDIT_WINDOW_CLOSED" };
  }
  return { ready: true };
}

export function assertPromoGuard(
  config: MediaKnowledgeConfig,
  projectId: string,
  requestedUsd: number,
  now = Date.now(),
): void {
  const readiness = inspectPromoGuard(config, projectId, requestedUsd, now);
  if (readiness.ready) return;
  const details: Record<NonNullable<PromoGuardReadiness["code"]>, string> = {
    PROMO_ACCOUNT_TYPE_NOT_VERIFIED:
      "confirm the exact Billing Overview account type and promotional-credit risk mode",
    PROMO_CREDIT_NOT_RECENTLY_VERIFIED:
      "verify the remaining Google promotional credit in Settings within the last 24 hours",
    PROMO_PROJECT_NOT_VERIFIED:
      "selected project does not match the recently verified promotional-credit project",
    PROMO_TERMS_NOT_VERIFIED:
      "billing account mode or promotion expiry changed since the last confirmation",
    PROMO_BALANCE_NOT_VERIFIED:
      "confirmed promotional credit is insufficient or missing",
    PROMO_CREDIT_WINDOW_CLOSED:
      "Google processing is disabled before credit expiry",
  };
  throw new Error(`${readiness.code}: ${details[readiness.code!]}`);
}
