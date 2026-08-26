import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import { zMediaKnowledgeConfig } from "@myceliasdk/media.ts";
import { assertPromoGuard, inspectPromoGuard } from "./promo-guard.ts";

const now = new Date("2026-08-21T12:00:00.000Z").getTime();

function config(overrides: Record<string, unknown> = {}) {
  const base = zMediaKnowledgeConfig.parse({
    promoGuard: {
      promotionExpiresAt: "2026-09-24T00:00:00.000Z",
      stopBeforeHours: 72,
      monthlyGrossLimitUsd: 1,
      dailyGrossLimitUsd: 0.1,
      perImportGrossLimitUsd: 0.01,
      creditVerifiedAt: "2026-08-21T11:00:00.000Z",
      creditVerifiedProjectId: "mycelia-media-260821",
      verifiedRemainingUsd: 300,
      verifiedBillingAccountType: "free_trial",
      creditVerifiedBillingAccountType: "free_trial",
      creditVerifiedPromotionExpiresAt: "2026-09-24T00:00:00.000Z",
      ...overrides,
    },
  });
  return base;
}

Deno.test("promo guard requires an explicit Free trial account confirmation", () => {
  const result = inspectPromoGuard(
    config({ verifiedBillingAccountType: undefined }),
    "mycelia-media-260821",
    0.01,
    now,
  );
  assertEquals(result, {
    ready: false,
    code: "PROMO_ACCOUNT_TYPE_NOT_VERIFIED",
  });
  assertThrows(
    () =>
      assertPromoGuard(
        config({ verifiedBillingAccountType: undefined }),
        "mycelia-media-260821",
        0.01,
        now,
      ),
    Error,
    "Billing Overview account type",
  );
});

Deno.test("paid usage acknowledgement stays open without a fresh promo balance", () => {
  assertEquals(
    inspectPromoGuard(
      config({
        creditVerifiedAt: undefined,
        verifiedRemainingUsd: undefined,
        promotionExpiresAt: undefined,
        verifiedBillingAccountType: "paid_with_promo",
        creditVerifiedBillingAccountType: "paid_with_promo",
      }),
      "mycelia-media-260821",
      0.01,
      now,
    ),
    { ready: true },
  );
  assertEquals(
    inspectPromoGuard(
      config({
        creditVerifiedAt: undefined,
        verifiedBillingAccountType: "paid_with_promo",
        creditVerifiedBillingAccountType: "paid_with_promo",
      }),
      "different-project",
      0.01,
      now,
    ).code,
    "PROMO_PROJECT_NOT_VERIFIED",
  );
});

Deno.test("promo guard is ready only for the confirmed project and live window", () => {
  assertEquals(
    inspectPromoGuard(config(), "mycelia-media-260821", 0.01, now),
    { ready: true },
  );
  assertEquals(
    inspectPromoGuard(
      config({ creditVerifiedAt: "2026-08-19T11:00:00.000Z" }),
      "mycelia-media-260821",
      0.01,
      now,
    ).code,
    "PROMO_CREDIT_NOT_RECENTLY_VERIFIED",
  );
  assertEquals(
    inspectPromoGuard(config(), "different-project", 0.01, now).code,
    "PROMO_PROJECT_NOT_VERIFIED",
  );
  assertEquals(
    inspectPromoGuard(
      config({
        promotionExpiresAt: "2026-08-22T00:00:00.000Z",
        creditVerifiedPromotionExpiresAt: "2026-08-22T00:00:00.000Z",
      }),
      "mycelia-media-260821",
      0.01,
      now,
    ).code,
    "PROMO_CREDIT_WINDOW_CLOSED",
  );
  assertEquals(
    inspectPromoGuard(
      config({ promotionExpiresAt: "2026-10-01T00:00:00.000Z" }),
      "mycelia-media-260821",
      0.01,
      now,
    ).code,
    "PROMO_TERMS_NOT_VERIFIED",
  );
});
