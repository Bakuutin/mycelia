/**
 * Map a high-dimensional speaker embedding to a single hue by projecting into 1D using pre-fit PCA parameters
 */


import pcaParams from "../modules/audio/pca.json" with { type: "json" };

interface PCAParams {
  n_components: number;
  mean: number[];
  components: number[][];
  pca_min: number[];
  pca_range: number[];
}

const params = pcaParams as PCAParams;

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h * 6 < 1) {
    r = c;
    g = x;
    b = 0;
  } else if (h * 6 < 2) {
    r = x;
    g = c;
    b = 0;
  } else if (h * 6 < 3) {
    r = 0;
    g = c;
    b = x;
  } else if (h * 6 < 4) {
    r = 0;
    g = x;
    b = c;
  } else if (h * 6 < 5) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function embeddingToColor(embedding: number[] | null | undefined): string | null {
  if (!embedding || embedding.length === 0) {
    return null;
  }

  const mean = params.mean;
  const components = params.components[0];
  const pcaMin = params.pca_min[0];
  const pcaRange = params.pca_range[0];

  if (embedding.length !== mean.length || embedding.length !== components.length) {
    return null;
  }

  const centered = embedding.map((val, i) => val - mean[i]);
  const pcaValue = centered.reduce((sum, val, i) => sum + val * components[i], 0);

  const normalized = (pcaValue - pcaMin) / pcaRange;
  const hue = normalized % 1;

  const [r, g, b] = hsvToRgb(hue, 1.0, 1.0);
  return `rgb(${r}, ${g}, ${b})`;
}

