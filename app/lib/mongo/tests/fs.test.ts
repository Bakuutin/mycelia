import { expect, fn } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { FsResource, getFsResource } from "../fs.server.ts";
import { withFixtures } from "@/tests/fixtures.ts";
import { ObjectId } from "mongodb";

Deno.test(
  "should upload a file and download it back",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const fs = await getFsResource(auth);
    const upload = await fs({
      action: "upload",
      bucket: "test",
      filename: "file.bin",
      data: new Uint8Array([1, 2, 3]),
      metadata: { foo: "bar" },
    });
    expect(upload).toBeInstanceOf(ObjectId);

    const download = await fs({
      action: "download",
      bucket: "test",
      id: upload,
    });
    expect(download).toEqual(new Uint8Array([1, 2, 3]));
  }),
);


Deno.test(
  "should download a file",
  withFixtures([
      "Admin",
      "uploadedFile",
  ], async (auth: Auth, { uploadId }: { uploadId: ObjectId }) => {
    const fs = await getFsResource(auth);

    const download = await fs({
      action: "download",
      bucket: "test",
      id: uploadId.toString(),
    });
    expect(download).toBeInstanceOf(Uint8Array);
  }),
);

Deno.test("should find files", withFixtures([
  "Admin",
  "uploadedFile",
], async (auth: Auth, { uploadId }: { uploadId: ObjectId }) => {
  const fs = await getFsResource(auth);
  const req = {
    action: "find" as const,
    bucket: "test",
    query: {},
  };
  const result = await fs(req);
  expect(Array.isArray(result)).toBe(true);
  expect(result[0]).toHaveProperty("_id", uploadId);
}));
