import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import _ from "lodash";
import { authenticateOr401 } from "../lib/auth/core.server.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const lastIdParam = url.searchParams.get("lastId");

  if (!startParam) {
    console.log("No start parameter");
    return { segments: [] };
  }

  const startDate = new Date(startParam);
  let limit: number = parseInt(url.searchParams.get("limit")!) || 10;
  if (isNaN(startDate.getTime())) {
    throw new Response("Invalid start parameter", { status: 400 });
  }

  if (isNaN(limit) || limit <= 0) {
    limit = 10;
  }

  const collection = auth.db.collection("ts_audio");

  const load = async (filter: any) =>
    collection
      .find(filter, { sort: { start: 1 }, limit });

  let segments: any[] = [];

  const filter: any = { start: { $gte: startDate } };

  if (lastIdParam) {
    const [originalIdString, prevIndexString] = lastIdParam.split("-");
    const originalId = new ObjectId(originalIdString);
    const prevIndex = parseInt(prevIndexString);
    const prevSegment = await collection.findOne({
      meta: {
        original_id: new ObjectId(originalId),
      },
      index: prevIndex,
    });
    if (!prevSegment) {
      throw new Response("Invalid lastId parameter", { status: 400 });
    }

    segments = await load({
      start: { $gt: prevSegment.start },
      meta: { original_id: prevSegment.original_id },
    });
    const lastIdIndex = segments.findIndex((segment) =>
      segment.index  === prevIndex
    );
    if (lastIdIndex != -1) {
      segments = segments.slice(lastIdIndex + 1);
    }

    if (segments.length < 1) {
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
      originalID: segment.meta.original_id.toString(),
      _id: `${segment.meta.original_id}-${segment.index}`,
    }));

  console.log("Segments", segments.map((segment) => segment.start));

  return ({ segments });
}
