import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import _ from "lodash";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { z } from "zod";

const zAudioQueryParams = z.object({
  start: z.string().transform((val: string) => new Date(val)),
  lastId: z.string().optional().nullable(),
  limit: z.string().transform((val: string) => parseInt(val, 10)).optional()
    .nullable(),
});

const zAudioSegment = z.object({
  start: z.date(),
  data: z.string(),
  originalID: z.string(),
  _id: z.string(),
});

const zAudioResponse = z.object({
  segments: z.array(zAudioSegment),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const lastIdParam = url.searchParams.get("lastId");
  const limitParam = url.searchParams.get("limit");

  if (!startParam) {
    throw new Response("Missing required 'start' parameter", { status: 400 });
  }

  const queryParams = zAudioQueryParams.parse({
    start: startParam,
    lastId: lastIdParam,
    limit: limitParam,
  });

  const startDate = queryParams.start;
  let limit: number = queryParams.limit || 10;

  if (isNaN(startDate.getTime())) {
    throw new Response("Invalid start parameter", { status: 400 });
  }

  if (isNaN(limit) || limit <= 0) {
    limit = 10;
  }

  const mongoResource = await getMongoResource(auth);

  const load = async (filter: any) =>
    mongoResource({
      action: "find",
      collection: "audio_chunks",
      query: filter,
      options: { sort: { start: 1 }, limit },
    });

  let segments: any[] = [];

  const filter: any = { start: { $gte: startDate } };

  if (queryParams.lastId) {
    const prevSegment = await mongoResource({
      action: "findOne",
      collection: "audio_chunks",
      query: { _id: new ObjectId(queryParams.lastId) },
    });
    if (!prevSegment) {
      throw new Response("Invalid lastId parameter", { status: 400 });
    }

    segments = await load({
      start: { $gt: prevSegment.start },
      original_id: prevSegment.original_id,
    });

    if (segments.length === 0) {
      segments = await load({ start: { $gt: prevSegment.start } });
    }
  } else {
    segments = await load(filter);
  }

  segments = segments
    .slice(0, 1)
    .map((segment: any) => ({
      start: segment.start,
      data: segment.data.buffer.toString("base64"),
      originalID: segment.original_id?.toString() || "",
      _id: `${segment._id.toString()}`,
    }));

  console.log("Segments", segments.map((segment) => segment.start));

  const response = { segments };
  return zAudioResponse.parse(response);
}
