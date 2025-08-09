import { expect, fn } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getFileExtension, uploadToGridFS } from "@/lib/mongo/fs.server.ts";

Deno.test(
  "uploadToGridFS should upload file successfully",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const fileData = new Uint8Array([1, 2, 3, 4]);
    const file = new File([fileData], "test.txt", { type: "text/plain" });
    const fileId = await uploadToGridFS(auth, file, "test-bucket", {
      category: "document",
    });

    expect(fileId).toBeInstanceOf(ObjectId);
  }),
);

Deno.test("getFileExtension should extract correct extension", async () => {
  expect(getFileExtension("test.txt")).toBe("txt");
  expect(getFileExtension("document.pdf")).toBe("pdf");
  expect(getFileExtension("file.with.multiple.dots.txt")).toBe("txt");
  expect(getFileExtension("Dockerfile")).toBe("Dockerfile");
  expect(getFileExtension("file.with.invalid.extension.t@t")).toBe("");
  expect(getFileExtension("")).toBe("");
});
