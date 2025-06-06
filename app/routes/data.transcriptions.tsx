import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import _ from "lodash";
import { authenticateOr401 } from "../lib/auth/core.server.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  if (!startParam || !endParam) {
    return { transcriptions: [] };
  }


  const startDate = new Date(startParam);
  const endDate = new Date(endParam);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Response(null, { status: 400 });
  }

  const collection = auth.db.collection("transcriptions");

  const data = await collection.find({
    start: { $gte: startDate, $lte: endDate },
  }, {
    sort: { start: 1 },
    limit: 30,
  });

  return { transcriptions: data };
}
