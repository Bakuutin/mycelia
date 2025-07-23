import { ActionFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getFsResource } from "@/lib/mongo/fs.server.ts";

const uploadBucketName = "uploads";

const uploadSchema = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
});

export type UploadData = z.infer<typeof uploadSchema>;

export function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop();
  return (ext && /^[a-zA-Z0-9]+$/.test(ext)) ? ext : "";
}

export async function validateAndParseFormData(
  request: Request,
): Promise<{ file: File; data: UploadData }> {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  if (!file || !(file instanceof File)) {
    throw new Response("File is required", { status: 400 });
  }

  const metadataStr = formData.get("metadata") as string;

  let metadata: Record<string, any> = {};
  if (metadataStr) {
    try {
      metadata = JSON.parse(metadataStr);
    } catch (error) {
      throw new Response("Invalid metadata JSON", { status: 400 });
    }
  }

  const data = uploadSchema.parse({
    metadata,
  });

  return { file, data };
}

export async function uploadToGridFS(
  auth: Auth,
  file: File,
  data: UploadData,
): Promise<ObjectId> {
  const fsResource = await getFsResource(auth);
  return await fsResource({
    action: "upload",
    bucket: uploadBucketName,
    filename: file.name,
    data: new Uint8Array(await file.arrayBuffer()),
    metadata: {
      ...data.metadata,
      extension: getFileExtension(file.name),
      uploaded_by: auth.principal,
      uploaded_at: new Date(),
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticateOr401(request);
  const { file, data } = await validateAndParseFormData(request);

  const fileId = await uploadToGridFS(auth, file, data);

  return Response.json({
    success: true,
    file_id: fileId.toString(),
    size: file.size,
  });
}
