import { expect } from "@std/expect";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { mediaFileBelongsToPrincipal } from "./api.files.$id.ts";

Deno.test(
  "media files allow canonical and active staged references owned by the principal",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "owner-a";
    const now = new Date("2026-08-21T12:00:00.000Z");
    const canonicalOriginalId = new ObjectId();
    const canonicalPreviewId = new ObjectId();
    const stagedOriginalId = new ObjectId();
    const stagedPreviewId = new ObjectId();

    await db.collection("media_assets").insertOne({
      owner,
      managedOriginal: { fileId: canonicalOriginalId },
      preview: { fileId: canonicalPreviewId },
    });
    await db.collection("media_imports").insertOne({
      owner,
      status: "preview",
      expiresAt: new Date("2026-08-21T13:00:00.000Z"),
      items: [{
        managedOriginal: { fileId: stagedOriginalId },
        thumbnail: { fileId: stagedPreviewId },
      }],
    });

    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_originals",
        canonicalOriginalId,
        owner,
        now,
      ),
    ).toBe(true);
    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_previews",
        canonicalPreviewId,
        owner,
        now,
      ),
    ).toBe(true);
    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_originals",
        stagedOriginalId,
        owner,
        now,
      ),
    ).toBe(true);
    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_previews",
        stagedPreviewId,
        owner,
        now,
      ),
    ).toBe(true);
  }),
);

Deno.test(
  "media files deny cross-owner, expired staging, and wrong-bucket references",
  withFixtures(["Mongo"], async ({ db }) => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    const foreignOriginalId = new ObjectId();
    const foreignPreviewId = new ObjectId();
    const expiredStagedId = new ObjectId();
    const previewOnlyId = new ObjectId();

    await db.collection("media_assets").insertOne({
      owner: "owner-b",
      managedOriginal: { fileId: foreignOriginalId },
      thumbnail: { fileId: foreignPreviewId },
    });
    await db.collection("media_imports").insertOne({
      owner: "owner-a",
      status: "preview",
      expiresAt: new Date("2026-08-21T11:00:00.000Z"),
      items: [{ managedOriginal: { fileId: expiredStagedId } }],
    });
    await db.collection("media_assets").insertOne({
      owner: "owner-a",
      thumbnail: { fileId: previewOnlyId },
    });

    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_originals",
        foreignOriginalId,
        "owner-a",
        now,
      ),
    ).toBe(false);
    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_previews",
        foreignPreviewId,
        "owner-a",
        now,
      ),
    ).toBe(false);
    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_originals",
        expiredStagedId,
        "owner-a",
        now,
      ),
    ).toBe(false);
    expect(
      await mediaFileBelongsToPrincipal(
        db,
        "media_originals",
        previewOnlyId,
        "owner-a",
        now,
      ),
    ).toBe(false);
  }),
);
