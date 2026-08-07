import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureGridFSBucketExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const POINTS = "location_points";
const IMPORTS = "location_imports";
const SEGMENTS = "location_segments";
const GEONAMES = "geonames_cities";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, POINTS);
  await ensureIndexExists(db, POINTS, { ts: 1 }, { name: "location_point_ts" });
  await ensureIndexExists(
    db,
    POINTS,
    { hash: 1 },
    { name: "location_point_hash", unique: true },
  );
  await ensureIndexExists(
    db,
    POINTS,
    { importId: 1 },
    { name: "location_point_import" },
  );

  await ensureCollectionExists(db, IMPORTS);
  await ensureIndexExists(
    db,
    IMPORTS,
    { contentHash: 1 },
    { name: "location_import_content_hash", unique: true },
  );
  await ensureIndexExists(
    db,
    IMPORTS,
    { createdAt: 1 },
    { name: "location_import_created" },
  );

  await ensureCollectionExists(db, SEGMENTS);
  await ensureIndexExists(
    db,
    SEGMENTS,
    { start: 1, end: 1 },
    { name: "location_segment_range" },
  );
  await ensureIndexExists(
    db,
    SEGMENTS,
    { type: 1, start: 1 },
    { name: "location_segment_type_start" },
  );
  await ensureIndexExists(
    db,
    SEGMENTS,
    { loc: "2dsphere" },
    { name: "location_segment_loc", sparse: true },
  );

  await ensureCollectionExists(db, GEONAMES);
  await ensureIndexExists(
    db,
    GEONAMES,
    { geonameId: 1 },
    { name: "geonames_city_id", unique: true },
  );
  await ensureIndexExists(
    db,
    GEONAMES,
    { loc: "2dsphere" },
    { name: "geonames_city_loc" },
  );
  await ensureIndexExists(
    db,
    GEONAMES,
    { asciiName: 1 },
    { name: "geonames_city_ascii_name" },
  );
  await ensureIndexExists(
    db,
    GEONAMES,
    { population: -1 },
    { name: "geonames_city_population" },
  );

  await ensureGridFSBucketExists(db, "location_files");
}

export async function down(db: Db): Promise<void> {
  const indexes: Array<[string, string[]]> = [
    [POINTS, ["location_point_ts", "location_point_hash", "location_point_import"]],
    [IMPORTS, ["location_import_content_hash", "location_import_created"]],
    [
      SEGMENTS,
      [
        "location_segment_range",
        "location_segment_type_start",
        "location_segment_loc",
      ],
    ],
    [
      GEONAMES,
      [
        "geonames_city_id",
        "geonames_city_loc",
        "geonames_city_ascii_name",
        "geonames_city_population",
      ],
    ],
  ];
  for (const [collectionName, names] of indexes) {
    const collection = db.collection(collectionName);
    for (const name of names) {
      if (await collection.indexExists(name)) await collection.dropIndex(name);
    }
  }
}
