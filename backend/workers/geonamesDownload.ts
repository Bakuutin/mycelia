import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";

export const schema = z.object({
  type: z.literal("geonames_download"),
  citiesUrl: z.string().default(
    "https://download.geonames.org/export/dump/cities500.zip",
  ),
  countryInfoUrl: z.string().default(
    "https://download.geonames.org/export/dump/countryInfo.txt",
  ),
  batchSize: z.number().default(5000),
});

type GeonamesJobData = z.infer<typeof schema>;

const name = "geonames_download";

interface CityRow {
  geonameId: number;
  name: string;
  asciiName: string;
  loc: { type: "Point"; coordinates: [number, number] };
  countryCode: string;
  country: string;
  admin1: string;
  population: number;
  tz: string;
}

export function parseCountryInfo(text: string): Map<string, string> {
  const byIso = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length > 4 && cols[0]) byIso.set(cols[0], cols[4]);
  }
  return byIso;
}

export function parseCitiesTsv(
  text: string,
  countries: Map<string, string>,
): CityRow[] {
  const rows: CityRow[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 18) continue;
    const geonameId = Number(cols[0]);
    const lat = Number(cols[4]);
    const lng = Number(cols[5]);
    if (!Number.isFinite(geonameId) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    rows.push({
      geonameId,
      name: cols[1],
      asciiName: cols[2],
      loc: { type: "Point", coordinates: [lng, lat] },
      countryCode: cols[8],
      country: countries.get(cols[8]) ?? cols[8],
      admin1: cols[10],
      population: Number(cols[14]) || 0,
      tz: cols[17],
    });
  }
  return rows;
}

async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = schema.parse(job.data) as GeonamesJobData;
  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = env.MYCELIA_URL;
  const mongo = (input: any) =>
    callResource("mongo", input, { jwt, myceliaUrl });

  const { unzipSync } = await import("fflate");

  await job.updateProgress({ stage: "downloading" });
  const [citiesRes, countryRes] = await Promise.all([
    fetch(jobData.citiesUrl),
    fetch(jobData.countryInfoUrl),
  ]);
  if (!citiesRes.ok) {
    return {
      success: false,
      message: `Failed to download cities dump: HTTP ${citiesRes.status}`,
    };
  }
  if (!countryRes.ok) {
    return {
      success: false,
      message: `Failed to download countryInfo: HTTP ${countryRes.status}`,
    };
  }

  const countries = parseCountryInfo(await countryRes.text());

  await job.updateProgress({ stage: "extracting" });
  const zipBytes = new Uint8Array(await citiesRes.arrayBuffer());
  const entries = unzipSync(zipBytes);
  const txtName = Object.keys(entries).find((n) => n.endsWith(".txt"));
  if (!txtName) {
    return { success: false, message: "Cities dump contains no .txt entry" };
  }
  const rows = parseCitiesTsv(
    new TextDecoder().decode(entries[txtName]),
    countries,
  );

  let upserted = 0;
  for (let i = 0; i < rows.length; i += jobData.batchSize) {
    const batch = rows.slice(i, i + jobData.batchSize);
    await mongo({
      action: "bulkWrite",
      collection: "geonames_cities",
      operations: batch.map((row) => ({
        updateOne: {
          filter: { geonameId: row.geonameId },
          update: { $set: row },
          upsert: true,
        },
      })),
      options: { ordered: false },
    });
    upserted += batch.length;
    await job.updateProgress({
      stage: "upserting",
      upserted,
      total: rows.length,
    });
  }

  // Backfill place labels on stays created before the database existed.
  const jobs = (input: any) => callResource("jobs", input, { jwt, myceliaUrl });
  try {
    await jobs({
      action: "enqueue",
      data: { type: "location_processing" },
      trigger: {
        type: "manual",
        reason: "GeoNames database refreshed; backfilling stay place labels",
      },
    });
  } catch (err) {
    console.warn(
      `[${name}] Could not enqueue location_processing backfill:`,
      err instanceof Error ? err.message : err,
    );
  }

  return {
    success: true,
    cities: upserted,
    countries: countries.size,
    hasMore: false,
  };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(
    z.object({
      success: z.boolean(),
      cities: z.number().optional(),
      countries: z.number().optional(),
      message: z.string().optional(),
      hasMore: z.boolean().optional(),
    }),
  ),
  policies: [
    { resource: "db/geonames_cities", action: "*", effect: "allow" },
    { resource: "jobs/location_processing", action: "enqueue", effect: "allow" },
  ],
  allowedHosts: ["download.geonames.org:443"],
  maxConcurrency: 1,
  use,
};

export default capability;
