import { LoaderFunctionArgs } from "@remix-run/node";
import { ObjectId } from "mongodb";
import _ from "lodash";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { type Timestamp, zTimestamp } from "../types/timeline.ts";
import { fetchTimelineData, getDaysAgo } from "../services/timeline.server.ts";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { Resolution } from "@/services/timeline.server.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);

  const url = new URL(request.url);
  let params;
  try {
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const resolution = url.searchParams.get("resolution");

    params = {
      start: zTimestamp.parse(startParam),
      end: zTimestamp.parse(endParam),
      resolution: resolution as Resolution,
    };
  } catch (error) {
    console.error(error);
    throw new Response("Invalid format", { status: 400 });
  }

  const result = await fetchTimelineData(
    auth,
    params.start,
    params.end,
    params.resolution,
  );

  return Response.json(result);
}

// export async function loader({ request }: LoaderFunctionArgs) {
//   const auth = await authenticateOrRedirect(request);

//   const url = new URL(request.url);
//   let params;
//   try {
//     const startParam = url.searchParams.get("start");
//     const endParam = url.searchParams.get("end");

//     params = {
//       start: startParam
//         ? zTimestamp.parse(startParam)
//         : BigInt(getDaysAgo(30).getTime()) as Timestamp,
//       end: endParam
//         ? zTimestamp.parse(endParam)
//         : BigInt(getDaysAgo(-1).getTime()) as Timestamp,
//     };
//   } catch (error) {
//     console.error(error);
//     throw new Response("Invalid format", { status: 400 });
//   }

//   return  fetchTimelineData(auth, params.start, params.end);
// }
