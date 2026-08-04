import { Db, ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

/**
 * LLM routing becomes priority-based, mirroring STT provider profiles.
 *
 * - Every stored profile gets explicit enabled/priority fields. Only the
 *   previously active profile stays enabled so effective behavior does not
 *   change until the user opts other routes in.
 * - Deployments that still override providers through OPENAI_BASE_URL and
 *   OPENAI_API_KEY get the environment route included at a higher priority,
 *   preserving the old "environment wins" behavior as a managed route.
 */
export const up = async (db: Db) => {
  const configs = db.collection("configs");
  const config = await configs.findOne({ _id: SERVER_CONFIG_ID });
  const llmProfiles = config?.llmProfiles;
  if (!Array.isArray(llmProfiles?.profiles) || !llmProfiles.profiles.length) {
    return;
  }

  const activeProfileId = typeof llmProfiles.activeProfileId === "string"
    ? llmProfiles.activeProfileId
    : undefined;
  const hasActiveMatch = llmProfiles.profiles.some(
    (profile: { id?: unknown }) => profile.id === activeProfileId,
  );
  const profiles = llmProfiles.profiles.map(
    (profile: Record<string, unknown>, index: number) => ({
      ...profile,
      // Without a resolvable active profile, keep the first route enabled so
      // the stored config still passes the "one enabled route" invariant.
      enabled: typeof profile.enabled === "boolean" ? profile.enabled : (
        hasActiveMatch ? profile.id === activeProfileId : index === 0
      ),
      priority: typeof profile.priority === "number" ? profile.priority : 50,
    }),
  );

  const environmentConfigured = Boolean(
    Deno.env.get("OPENAI_BASE_URL")?.trim() &&
      Deno.env.get("OPENAI_API_KEY")?.trim(),
  );

  await configs.updateOne(
    { _id: SERVER_CONFIG_ID },
    {
      $set: {
        "llmProfiles.profiles": profiles,
        "llmProfiles.includeEnvironment":
          typeof llmProfiles.includeEnvironment === "boolean"
            ? llmProfiles.includeEnvironment
            : environmentConfigured,
        "llmProfiles.environmentPriority":
          typeof llmProfiles.environmentPriority === "number"
            ? llmProfiles.environmentPriority
            : environmentConfigured
            ? 10
            : 50,
        updatedAt: new Date(),
      },
    },
  );
};

export const down = async () => {
  // The added routing fields are additive and ignored by older builds.
};
