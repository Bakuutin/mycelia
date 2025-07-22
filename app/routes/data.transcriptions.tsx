import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import _ from "lodash";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

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

  const mongoResource = await getMongoResource(auth);

  const data = await mongoResource({
    action: "find",
    collection: "transcriptions",
    query: {
      start: { $gte: startDate, $lte: endDate },
    },
    options: {
      sort: { start: 1 },
      limit: 30,
    },
  });

  return { transcriptions: data };
}
