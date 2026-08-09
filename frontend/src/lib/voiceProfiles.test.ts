import { describe, expect, it } from "vitest";
import { buildAttachSampleOperations } from "./voiceProfiles";

describe("voice profile sample attachment", () => {
  it("links the sample immediately and enrolls by profile id", () => {
    expect(buildAttachSampleOperations("sample-1", {
      id: "profile-1",
      name: "Sky",
      isPrimary: true,
    })).toEqual({
      link: {
        action: "updateOne",
        collection: "voice_samples.files",
        query: { _id: { $oid: "sample-1" } },
        update: { $set: { "metadata.profile_id": "profile-1" } },
      },
      enrollment: {
        action: "enqueue",
        data: {
          type: "enrollment",
          name: "Sky",
          profile_id: "profile-1",
          is_primary: true,
          sample_file_id: "sample-1",
        },
      },
    });
  });
});
