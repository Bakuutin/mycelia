import { ActionFunctionArgs } from "@remix-run/node";
import { GridFSFile, ObjectId } from "mongodb";
import { z } from "zod";
import { Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import {
  addToProcessingQueue,
  getFileExtension,
} from "@/services/audio.server.ts";
import { redlock } from "@/lib/redis.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getFsResource } from "@/lib/mongo/fs.server.ts";

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
  metadata: Record<string, any>;
  created_by: string | null;
  processing_status: string;
  storage_key?: string;
};

function createSourceFileDocument(
  auth: Auth,
  file: GridFSFile,
): SourceFile {
  const id = new ObjectId();
  const ext = getFileExtension(file.filename);

  const metadata = {
    ...file.metadata,
  };

  const importer = file.metadata!.importer;
  delete metadata.importer;

  const start = new Date(file.metadata!.start as string);
  delete metadata.start;

  return {
    _id: id,
    start,
    size: file.length,
    extension: ext,
    ingested: false,
    importer,
    platform: {
      system: "api",
      node: "web",
    },
    metadata,
    created_by: auth.principal,
    processing_status: "queued",
  };
}

export async function createSourceFileDocuments(auth: Auth) {
  const mongoResource = await getMongoResource(auth);
  const fs = await getFsResource(auth);
  const files: GridFSFile[] = await fs({
    action: "find",
    bucket: "audio-files",
    query: {
      "metadata.source_file_id": {
        $exists: false,
      },
      metadata: {
        "start": {
          $exists: true,
        },
        "importer": {
          $exists: true,
        },
      },
    },
  });
  const { insertedIds } = await mongoResource({
    action: "insertMany",
    collection: "source_files",
    docs: files.map((file) => createSourceFileDocument(auth, file)),
  });
  // send to kafka?
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
