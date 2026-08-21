import { describe, expect, it } from "vitest";
import {
  buildAttachSampleOperations,
  buildTimelineSampleMetadata,
  orderVoiceProfilesByRecent,
  readRecentVoiceProfileIds,
  rememberVoiceProfile,
  summarizeVoiceSamples,
} from "./voiceProfiles";

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

describe("voice profile sample display", () => {
  it("uses saved GridFS samples instead of stale profile aggregates", () => {
    expect(summarizeVoiceSamples([
      { metadata: { duration: 15 } },
      { metadata: { duration: 39 } },
      { metadata: { duration: 13 } },
      { metadata: { duration: 9 } },
    ], { count: 2, duration: 54 })).toEqual({ count: 4, duration: 76 });
  });

  it("keeps profile aggregates while saved samples are loading", () => {
    expect(summarizeVoiceSamples(undefined, { count: 2, duration: 54 }))
      .toEqual({ count: 2, duration: 54 });
  });
});

describe("timeline voice samples", () => {
  it("records a durable profile link and source interval", () => {
    const metadata = buildTimelineSampleMetadata(
      { id: "profile-1", name: "Sky", isPrimary: true },
      new Date("2026-08-10T10:00:00.000Z"),
      new Date("2026-08-10T10:00:12.500Z"),
    );

    expect(metadata).toMatchObject({
      speaker_name: "Sky",
      profile_id: "profile-1",
      duration: 12.5,
      source: "timeline_selection",
      source_start: "2026-08-10T10:00:00.000Z",
      source_end: "2026-08-10T10:00:12.500Z",
    });
  });
});

describe("recent voice profiles", () => {
  it("keeps the most recently assigned speakers first across review clips", () => {
    localStorage.clear();
    rememberVoiceProfile("profile-belka");
    rememberVoiceProfile("profile-andrew");

    expect(readRecentVoiceProfileIds()).toEqual([
      "profile-andrew",
      "profile-belka",
    ]);
    expect(
      orderVoiceProfilesByRecent([
        { id: "profile-belka", name: "Belka" },
        { id: "profile-bowie", name: "Bowie" },
        { id: "profile-andrew", name: "Andrew" },
      ], (profile) => profile.id).map((profile) => profile.id),
    ).toEqual([
      "profile-andrew",
      "profile-belka",
      "profile-bowie",
    ]);
  });
});
