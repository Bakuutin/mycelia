import { createHash } from "node:crypto";

export type MediaEventClusterAsset = {
  assetId: string;
  capturedAt?: Date | string | null;
  location?: {
    latitude: number;
    longitude: number;
  } | null;
};

export type MediaEventClusteringOptions = {
  maxGapMinutes: number;
  maxDistanceKm: number;
  maxAssetsPerEvent?: number;
  minAssetsPerEvent?: number;
};

export type MediaEventCluster = {
  assetIds: string[];
  startAt: Date;
  endAt: Date;
  centroid?: {
    latitude: number;
    longitude: number;
  };
  stableKey: string;
};

type NormalizedAsset = {
  assetId: string;
  capturedAt: Date;
  location?: {
    latitude: number;
    longitude: number;
  };
};

const EARTH_RADIUS_KM = 6_371.0088;

function validCoordinate(
  value: MediaEventClusterAsset["location"],
): NormalizedAsset["location"] | undefined {
  if (
    !value || !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) || value.latitude < -90 ||
    value.latitude > 90 || value.longitude < -180 || value.longitude > 180
  ) {
    return undefined;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function mediaEventDistanceKm(
  left: NonNullable<NormalizedAsset["location"]>,
  right: NonNullable<NormalizedAsset["location"]>,
): number {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function stableKey(assetIds: string[]): string {
  const membership = [...assetIds].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const digest = createHash("sha256")
    .update(membership.join("\0"))
    .digest("hex");
  return `media-event-v1:${digest}`;
}

function toCluster(assets: NormalizedAsset[]): MediaEventCluster {
  const locations = assets.flatMap((asset) =>
    asset.location ? [asset.location] : []
  );
  const centroid = locations.length > 0
    ? {
      latitude: locations.reduce((sum, item) => sum + item.latitude, 0) /
        locations.length,
      longitude: locations.reduce((sum, item) => sum + item.longitude, 0) /
        locations.length,
    }
    : undefined;
  const assetIds = assets.map((asset) => asset.assetId);
  return {
    assetIds,
    startAt: new Date(assets[0].capturedAt),
    endAt: new Date(assets[assets.length - 1].capturedAt),
    ...(centroid ? { centroid } : {}),
    stableKey: stableKey(assetIds),
  };
}

/**
 * Deterministically groups assets by consecutive capture time and the last
 * known GPS coordinate. A missing coordinate does not split a time-coherent
 * event, but it also cannot bridge two known coordinates that are too far
 * apart. Assets without a valid capture time are returned separately.
 */
export function clusterMediaEventAssets(
  assets: MediaEventClusterAsset[],
  options: MediaEventClusteringOptions,
): { clusters: MediaEventCluster[]; skippedAssetIds: string[] } {
  const maxGapMs = Math.max(0, options.maxGapMinutes) * 60_000;
  const maxDistanceKm = Math.max(0, options.maxDistanceKm);
  const maxAssetsPerEvent = Math.max(
    2,
    Math.trunc(options.maxAssetsPerEvent ?? 50),
  );
  const minAssetsPerEvent = Math.max(
    2,
    Math.min(
      maxAssetsPerEvent,
      Math.trunc(options.minAssetsPerEvent ?? 2),
    ),
  );
  const normalized: NormalizedAsset[] = [];
  const skippedAssetIds: string[] = [];

  for (const asset of assets) {
    const capturedAt = asset.capturedAt == null
      ? null
      : new Date(asset.capturedAt);
    if (!capturedAt || !Number.isFinite(capturedAt.getTime())) {
      skippedAssetIds.push(asset.assetId);
      continue;
    }
    const location = validCoordinate(asset.location);
    normalized.push({
      assetId: asset.assetId,
      capturedAt,
      ...(location ? { location } : {}),
    });
  }

  normalized.sort((left, right) =>
    left.capturedAt.getTime() - right.capturedAt.getTime() ||
    (left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0)
  );
  skippedAssetIds.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );

  const clusters: MediaEventCluster[] = [];
  let current: NormalizedAsset[] = [];
  let lastKnownLocation: NormalizedAsset["location"];

  const finishCurrent = () => {
    if (current.length >= minAssetsPerEvent) {
      clusters.push(toCluster(current));
    }
    current = [];
    lastKnownLocation = undefined;
  };

  for (const asset of normalized) {
    const previous = current.at(-1);
    const exceedsTimeGap = previous
      ? asset.capturedAt.getTime() - previous.capturedAt.getTime() > maxGapMs
      : false;
    const exceedsDistance = asset.location && lastKnownLocation
      ? mediaEventDistanceKm(lastKnownLocation, asset.location) > maxDistanceKm
      : false;
    if (
      current.length >= maxAssetsPerEvent || exceedsTimeGap || exceedsDistance
    ) {
      finishCurrent();
    }
    current.push(asset);
    if (asset.location) lastKnownLocation = asset.location;
  }
  finishCurrent();

  return { clusters, skippedAssetIds };
}

/** Returns temporal-diversity indexes including both ends when possible. */
export function selectRepresentativeAssetIndexes(
  total: number,
  maximum: number,
): number[] {
  const count = Math.min(
    Math.max(0, Math.trunc(total)),
    Math.max(0, Math.trunc(maximum)),
  );
  if (count === 0) return [];
  if (count === 1) {
    return [Math.floor((Math.max(1, Math.trunc(total)) - 1) / 2)];
  }
  const lastIndex = Math.max(0, Math.trunc(total) - 1);
  return Array.from(
    { length: count },
    (_, index) => Math.round(index * lastIndex / (count - 1)),
  );
}
