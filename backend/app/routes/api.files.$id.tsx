import type { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getFsResource } from "@/lib/mongo/fs.server.ts";

const uploadBucketName = "uploads";

function contentTypeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "gpx":
      return "application/gpx+xml; charset=utf-8";
    case "geojson":
      return "application/geo+json; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);
  const id = params.id as string;
  if (!id || !ObjectId.isValid(id)) {
    return new Response("Invalid id", { status: 400 });
  }

  const fs = await getFsResource(auth);
  const files = await fs({
    action: "find",
    bucket: uploadBucketName,
    query: { _id: new ObjectId(id) },
  });
  if (!files || files.length === 0) {
    return new Response("Not found", { status: 404 });
  }
  const file = files[0];
  const data: Uint8Array = await fs({
    action: "download",
    bucket: uploadBucketName,
    id,
  });
  const ext: string = file?.metadata?.extension ||
    (file?.filename?.split(".").pop() ?? "");
  const contentType = contentTypeForExtension(ext || "");
  return new Response(data as unknown as BodyInit, { headers: { "Content-Type": contentType } });
}
