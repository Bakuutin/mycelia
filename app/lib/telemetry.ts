import { NodeSDK } from "npm:@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "npm:@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "npm:@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "npm:@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "npm:@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "npm:@opentelemetry/instrumentation-express";
import { MongoDBInstrumentation } from "npm:@opentelemetry/instrumentation-mongodb";
import { IORedisInstrumentation } from "npm:@opentelemetry/instrumentation-ioredis";
import { metrics, trace } from "npm:@opentelemetry/api@1";

const otlpEndpoint = Deno.env.get("OTEL_EXPORTER_OTLP_ENDPOINT") ??
  "http://localhost:4318";

const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint}/v1/traces`,
});
const metricExporter = new OTLPMetricExporter({
  url: `${otlpEndpoint}/v1/metrics`,
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 5000,
});

const sdk = new NodeSDK({
  traceExporter,
  metricReader,
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new MongoDBInstrumentation({
      enhancedDatabaseReporting: true,
      requireParentSpan: false,
    }),
    new IORedisInstrumentation(),
  ],
});

sdk.start();

export async function shutdownTelemetry(): Promise<void> {
  await sdk.shutdown();
}

export const tracer = trace.getTracer("mycelia", "1.0.0");
export const meter = metrics.getMeter("mycelia", "1.0.0");

export const requestCounter = meter.createCounter("http_requests_total", {
  description: "Total number of HTTP requests",
});

export const audioProcessingDuration = meter.createHistogram(
  "audio_processing_duration_seconds",
  {
    description: "Duration of audio processing operations",
    unit: "s",
  },
);

export const mongoOperationCounter = meter.createCounter(
  "mongo_operations_total",
  {
    description: "Total number of MongoDB operations",
  },
);

export const redisOperationCounter = meter.createCounter(
  "redis_operations_total",
  {
    description: "Total number of Redis operations",
  },
);
