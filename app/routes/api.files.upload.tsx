import { ActionFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import { uploadToGridFS } from "@/lib/mongo/fs.server.ts";

const uploadBucketName = "uploads";

const uploadSchema = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
  bucket: z.string().optional(),
});

export type UploadData = z.infer<typeof uploadSchema>;

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticateOr401(request);
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
  const fileId = await uploadToGridFS(
    auth,
    file,
    uploadBucketName,
    data.metadata || {},
  );

  return Response.json({
    success: true,
    file_id: fileId.toString(),
    size: file.size,
  });
}
