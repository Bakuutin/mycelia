import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { callResource } from "@/lib/api";

export interface ExternalServiceHealthSummary {
  id: string;
  label: string;
  status: "disabled" | "healthy" | "loading" | "unavailable" | "misconfigured";
  message: string;
}

interface PipelineHealthResponse {
  services?: ExternalServiceHealthSummary[];
}

export function getBlockingService(
  data: PipelineHealthResponse | undefined,
  serviceId: string,
): ExternalServiceHealthSummary | undefined {
  const service = data?.services?.find((candidate) =>
    candidate.id === serviceId
  );
  return service?.status === "healthy" ? undefined : service;
}

export function ServiceHealthBanner({
  serviceId = "diarizator",
}: {
  serviceId?: string;
}) {
  const { data } = useQuery({
    queryKey: ["pipeline-health", "service-banner"],
    queryFn: () =>
      callResource("jobs", { action: "pipeline_health" }) as Promise<
        PipelineHealthResponse
      >,
    refetchInterval: 30_000,
  });
  const service = getBlockingService(data, serviceId);
  if (!service) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div>
        <p className="font-medium">{service.label} is {service.status}</p>
        <p className="text-muted-foreground">{service.message}</p>
        {serviceId === "diarizator" && (
          <p className="mt-1 font-mono text-xs">cd diarizator &amp;&amp; docker compose --profile cpu up -d</p>
        )}
      </div>
    </div>
  );
}
