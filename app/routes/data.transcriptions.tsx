import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import _ from "lodash";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { z } from "zod";

const zTranscriptionQueryParams = z.object({
  start: z.string().transform((val: string) => new Date(val)),
  end: z.string().transform((val: string) => new Date(val)),
});

const zTranscriptionSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  no_speech_prob: z.number().optional(),
});

const zTranscription = z.object({
  _id: z.instanceof(ObjectId),
  start: z.date(),
  end: z.date(),
  text: z.string(),
  segments: z.array(zTranscriptionSegment),
  top_language_probs: z.array(z.any()).optional(),
});

const zTranscriptionResponse = z.object({
  transcriptions: z.array(zTranscription),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  if (!startParam || !endParam) {
    return { transcriptions: [] };
  }

  const queryParams = zTranscriptionQueryParams.parse({
    start: startParam,
    end: endParam,
  });

  const startDate = queryParams.start;
  const endDate = queryParams.end;

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

  const response = { transcriptions: data };
  return zTranscriptionResponse.parse(response);
}
