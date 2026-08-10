import { describe, expect, it } from "vitest";
import { prepareJobLaunchSchema } from "./jobLaunchDefaults";

describe("prepareJobLaunchSchema", () => {
  it("turns profileReenrollment profileId into a named selector defaulting to primary", () => {
    const schema = {
      type: "object",
      properties: {
        type: { const: "profileReenrollment", type: "string" },
        profileId: { type: "string", minLength: 1 },
      },
      required: ["type", "profileId"],
    };

    const prepared = prepareJobLaunchSchema(schema, "profileReenrollment", [
      { _id: { $oid: "other-id" }, name: "Other" },
      { _id: { $oid: "sky-id" }, name: "Sky", is_primary: true },
    ]);

    expect(prepared.properties.profileId).toMatchObject({
      default: "sky-id",
      oneOf: [
        { const: "other-id", title: "Other" },
        { const: "sky-id", title: "Sky (primary)" },
      ],
    });
  });
});
