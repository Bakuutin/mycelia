import { expect, fn } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { ObjectId } from "mongodb";
import {
  getFileExtension,
  type UploadData,
  uploadToGridFS,
  validateAndParseFormData,
} from "../routes/api.files.upload.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts"

Deno.test(
  "validateAndParseFormData should parse valid form data",
  withFixtures([
    "Admin",
    "uploadedFile",
  ], async (auth: Auth) => {
    const fileData = new Uint8Array([1, 2, 3, 4]);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([fileData], { type: "text/plain" }),
      "test.txt",
    );
    formData.append(
      "metadata",
      JSON.stringify({ category: "document", size: 4 }),
    );

    const request = new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: formData,
    });

    const result = await validateAndParseFormData(request);

    expect(result.file).toBeInstanceOf(File);
    expect(result.file.name).toBe("test.txt");
    expect(result.file.size).toBe(4);
    expect(result.data.metadata).toEqual({ category: "document", size: 4 });
  }),
);

Deno.test(
  "validateAndParseFormData should handle missing metadata",
  withFixtures([
    "Admin",
  ], async (auth: Auth) => {
    const fileData = new Uint8Array([1, 2, 3, 4]);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([fileData], { type: "text/plain" }),
      "test.txt",
    );
    // No metadata field

    const request = new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: formData,
    });

    const result = await validateAndParseFormData(request);

    expect(result.file).toBeInstanceOf(File);
    expect(result.file.name).toBe("test.txt");
    expect(result.data.metadata).toEqual({});
  }),
);

Deno.test(
  "validateAndParseFormData should reject missing file",
  withFixtures([
    "Admin",
  ], async (auth: Auth) => {
    const formData = new FormData();
    formData.append("metadata", JSON.stringify({ category: "document" }));
    // No file field

    const request = new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: formData,
    });

    try {
      await validateAndParseFormData(request);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
    }
  }),
);

Deno.test(
  "validateAndParseFormData should reject invalid metadata JSON",
  withFixtures([
    "Admin",
  ], async (auth: Auth) => {
    const fileData = new Uint8Array([1, 2, 3, 4]);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([fileData], { type: "text/plain" }),
      "test.txt",
    );
    formData.append("metadata", "invalid-json");

    const request = new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: formData,
    });

    try {
      await validateAndParseFormData(request);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
    }
  }),
);

Deno.test(
  "uploadToGridFS should upload file successfully",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const fileData = new Uint8Array([1, 2, 3, 4]);
    const file = new File([fileData], "test.txt", { type: "text/plain" });
    const data: UploadData = { metadata: { category: "document" } };

    const fileId = await uploadToGridFS(auth, file, data);

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
