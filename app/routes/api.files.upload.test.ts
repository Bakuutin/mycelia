import { expect, fn } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { Policy, resourceManager } from "@/lib/auth/resources.ts";
import { FsResource, getFsResource } from "@/lib/mongo/fs.server.ts";
import { ObjectId } from "mongodb";
import {
  type UploadData,
  validateAndParseFormData,
} from "./api.files.upload.tsx";

const fsResourceInstance = new FsResource();
resourceManager.registerResource(fsResourceInstance);

let auth: Auth;

function setup(policies?: Policy[]) {
  auth = new Auth({
    principal: "files-upload-tester",
    policies: policies ?? [
      { resource: "fs/*", action: "*", effect: "allow" },
    ],
  });

  // Mock GridFS operations
  fsResourceInstance.getBucket = async () => ({
    openUploadStream: fn(() => ({
      end: fn(),
      on: fn((event: string, cb: any) => {
        if (event === "finish") {
          queueMicrotask(() => cb());
        }
      }),
    })),
  } as any);
}

Deno.test("validateAndParseFormData should parse valid form data", async () => {
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
});

Deno.test("validateAndParseFormData should handle missing metadata", async () => {
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
});

Deno.test("validateAndParseFormData should reject missing file", async () => {
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
});

Deno.test("validateAndParseFormData should reject invalid metadata JSON", async () => {
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
});

Deno.test("should test GridFS resource integration", async () => {
  setup();

  // Test that we can use the modern GridFS resource API
  const fsResource = await getFsResource(auth);

  // Test GridFS upload
  const mockUploadResult = await fsResource({
    action: "upload",
    bucket: "test",
    filename: "test.txt",
    data: new Uint8Array([1, 2, 3, 4]),
    metadata: { category: "document" },
  });

  expect(mockUploadResult).toBeInstanceOf(ObjectId);
});

Deno.test("should test GridFS download", async () => {
  setup();

  // Mock download stream
  fsResourceInstance.getBucket = async () => ({
    openDownloadStream: fn(() => ({
      on: fn((event: string, cb: any) => {
        if (event === "data") cb(new Uint8Array([1, 2, 3, 4]));
        if (event === "end") cb();
      }),
    })),
  } as any);

  const fsResource = await getFsResource(auth);

  // Test GridFS download
  const mockDownloadResult = await fsResource({
    action: "download",
    bucket: "test",
    id: "507f1f77bcf86cd799439011",
  });

  expect(mockDownloadResult).toBeInstanceOf(Uint8Array);
});

Deno.test("should test GridFS find", async () => {
  setup();

  // Mock find operation
  fsResourceInstance.getBucket = async () => ({
    find: fn(() => ({
      toArray: fn(() =>
        Promise.resolve([
          { _id: "abc", filename: "file.txt" },
        ])
      ),
    })),
  } as any);

  const fsResource = await getFsResource(auth);

  // Test GridFS find
  const mockFindResult = await fsResource({
    action: "find",
    bucket: "test",
    query: {},
  });

  expect(Array.isArray(mockFindResult)).toBe(true);
  expect(mockFindResult.length).toBe(1);
  expect(mockFindResult[0].filename).toBe("file.txt");
});

Deno.test("getFileExtension should extract correct extension", async () => {
  const { getFileExtension } = await import("./api.files.upload.tsx");

  expect(getFileExtension("test.txt")).toBe("txt");
  expect(getFileExtension("document.pdf")).toBe("pdf");
  expect(getFileExtension("file.with.multiple.dots.txt")).toBe("txt");
  expect(getFileExtension("Dockerfile")).toBe("Dockerfile");
  expect(getFileExtension("file.with.invalid.extension.t@t")).toBe("");
  expect(getFileExtension("")).toBe("");
});
