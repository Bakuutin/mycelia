import { ActionFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import {
  addToProcessingQueue,
  getFileExtension,
} from "@/services/audio.server.ts";
import { redlock } from "@/lib/redis.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getFsResource } from "@/lib/mongo/fs.server.ts";

const ingestSchema = z.object({
  start: z.string().datetime(),
  idempotence_key: z.string().min(10).max(255),
  metadata: z.record(z.string(), z.any()),
});

export type IngestData = z.infer<typeof ingestSchema>;
export type SourceFile = {
  _id: ObjectId;
  start: Date;
  size: number;
  extension: string;
  ingested: boolean;
  importer: string;
  platform: {
    system: string;
    node: string;
  };
  idempotence_key: string;
  metadata: Record<string, any>;
  created_by: string | null;
  processing_status: string;
  storage_key?: string;
};

export async function validateAndParseFormData(
  request: Request,
): Promise<{ audioFile: File; data: IngestData }> {
  const formData = await request.formData();
  const audioFile = formData.get("audio") as File;

  if (!audioFile || !(audioFile instanceof File)) {
    throw new Response("Audio file is required", { status: 400 });
  }

  const start = formData.get("start") as string;
  const idempotenceKey = formData.get("idempotence_key") as string;
  const metadataStr = formData.get("metadata") as string;

  let metadata: Record<string, any>;
  try {
    metadata = JSON.parse(metadataStr);
  } catch (error) {
    throw new Response("Invalid metadata JSON", { status: 400 });
  }

  const data = ingestSchema.parse({
    start,
    idempotence_key: idempotenceKey,
    metadata,
  });

  return { audioFile, data };
}

export async function checkExistingSourceFile(
  auth: Auth,
  idempotenceKey: string,
): Promise<SourceFile | null> {
  const mongoResource = await getMongoResource(auth);
  return await mongoResource({
    action: "findOne",
    collection: "source_files",
    query: { idempotence_key: idempotenceKey },
  });
}

function createSourceFileDocument(
  auth: Auth,
  data: IngestData,
  audioFile: File,
): SourceFile {
  const id = new ObjectId();
  const ext = getFileExtension(audioFile.name);

  return {
    _id: id,
    start: new Date(data.start),
    size: audioFile.size,
    extension: ext,
    ingested: false,
    importer: "api_upload",
    platform: {
      system: "api",
      node: "web",
    },
    idempotence_key: data.idempotence_key,
    metadata: data.metadata,
    created_by: auth.principal,
    processing_status: "uploading",
  };
}

async function processAudioUpload(
  auth: Auth,
  sourceFile: SourceFile,
  audioFile: File,
): Promise<ObjectId> {
  try {
    const fsResource = await getFsResource(auth);
    const storageKey = await fsResource({
      action: "upload",
      bucket: "audio-files",
      filename: sourceFile._id.toString(),
      data: new Uint8Array(await audioFile.arrayBuffer()),
    });

    const mongoResource = await getMongoResource(auth);
    await mongoResource({
      action: "updateOne",
      collection: "source_files",
      query: { _id: sourceFile._id },
      update: {
        $set: {
          storage_key: storageKey,
          processing_status: "queued",
        },
      },
    });

    await addToProcessingQueue(sourceFile._id.toString());
    return storageKey;
  } catch (error) {
    const mongoResource = await getMongoResource(auth);
    await mongoResource({
      action: "deleteOne",
      collection: "source_files",
      query: { _id: sourceFile._id },
    });
    throw error;
  }
}

async function handleIngestWithLock(
  auth: Auth,
  audioFile: File,
  data: IngestData,
): Promise<Response> {
  return redlock.using(
    [data.idempotence_key],
    60 * 1000,
    async () => {
      const existingSourceFile = await checkExistingSourceFile(
        auth,
        data.idempotence_key,
      );

      if (existingSourceFile) {
        return Response.json({
          success: true,
          original_id: existingSourceFile._id.toString(),
          processing_status: existingSourceFile.processing_status,
          message: "Recording already exists",
        });
      }

      const sourceFile = createSourceFileDocument(auth, data, audioFile);
      const mongoResource = await getMongoResource(auth);
      await mongoResource({
        action: "insertOne",
        collection: "source_files",
        doc: sourceFile,
      });
      await processAudioUpload(auth, sourceFile, audioFile);

      return Response.json({
        success: true,
        original_id: sourceFile._id.toString(),
      });
    },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticateOr401(request);
  const { audioFile, data } = await validateAndParseFormData(request);

  try {
    return await handleIngestWithLock(auth, audioFile, data);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw new Response("Upload failed", { status: 500 });
  }
}
