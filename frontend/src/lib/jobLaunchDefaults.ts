import { normalizeObjectId } from "./diarization";

type SpeakerProfile = {
  _id?: unknown;
  name?: string;
  is_primary?: boolean;
};

type JsonSchema = Record<string, any>;

export function prepareJobLaunchSchema(
  schema: JsonSchema,
  jobType: string,
  profiles: SpeakerProfile[],
): JsonSchema {
  if (jobType !== "profileReenrollment") return schema;

  const choices = profiles.flatMap((profile) => {
    const id = normalizeObjectId(profile._id);
    if (!id) return [];
    const name = profile.name?.trim() || id;
    return [{
      const: id,
      title: profile.is_primary ? `${name} (primary)` : name,
    }];
  });
  if (choices.length === 0) return schema;

  const primaryId = normalizeObjectId(
    profiles.find((profile) => profile.is_primary)?._id,
  );
  return {
    ...schema,
    properties: {
      ...(schema.properties ?? {}),
      profileId: {
        ...(schema.properties?.profileId ?? {}),
        title: "Voice profile",
        oneOf: choices,
        default: primaryId ?? choices[0].const,
      },
    },
  };
}
