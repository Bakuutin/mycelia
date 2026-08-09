import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Run = {
  runId: string;
  status: "building" | "ready" | "active" | "superseded" | "failed";
  generation: number;
  embeddingSpaceId: string;
  range?: { start: Date; end: Date };
};

type Profile = {
  _id: unknown;
  name: string;
  is_primary?: boolean;
  revision?: number;
  embeddingSpaceId?: string;
};
type Calibration = {
  calibrationId: string;
  status: string;
  profileId: string;
  profileRevision: number;
  updatedAt?: Date;
};

export function VoiceIdentityOperations() {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24 * 7);
  const range = useMemo(
    () => ({
      start: new Date(Date.now() - hours * 3_600_000),
      end: new Date(),
    }),
    [hours],
  );

  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ["speaker-runs"],
    queryFn: () =>
      callResource("speaker-segments", { action: "list-runs" }) as Promise<
        Run[]
      >,
    refetchInterval: 10_000,
  });
  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ["speaker-profiles", "voice-identity"],
    queryFn: () =>
      callResource("mongo", {
        action: "find",
        collection: "speaker_profiles",
        query: {},
        options: { sort: { is_primary: -1 } },
      }) as Promise<Profile[]>,
  });
  const primary = profiles.find((profile) => profile.is_primary);
  const primaryId = primary ? normalizeObjectId(primary._id) : null;
  const { data: calibrations = [] } = useQuery<Calibration[]>({
    queryKey: ["speaker-calibrations", primaryId],
    enabled: Boolean(primaryId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "list-calibrations",
        profileId: primaryId,
      }) as Promise<Calibration[]>,
  });
  const calibration = calibrations.find((item) =>
    item.status === "validated" &&
    item.profileRevision === (primary?.revision ?? 1)
  );
  const activeRun = runs.find((run) => run.status === "active");

  const operation = useMutation({
    mutationFn: async (kind: "classify" | "missing" | "rediarize") => {
      if (kind === "classify") {
        if (!activeRun || !primaryId || !calibration) {
          throw new Error(
            "Active run, primary profile and validated calibration are required",
          );
        }
        return await callResource("jobs", {
          action: "enqueue",
          data: {
            type: "speakerIdentity",
            runId: activeRun.runId,
            profileId: primaryId,
            profileRevision: primary?.revision ?? 1,
            calibrationId: calibration.calibrationId,
            ...range,
            limit: 1000,
          },
          trigger: {
            type: "manual",
            reason: "Classify existing speaker embeddings",
          },
        });
      }
      if (kind === "missing") {
        return await callResource("jobs", {
          action: "enqueue",
          data: { type: "diarization", mode: "missing", ...range, limit: 4 },
          trigger: { type: "manual", reason: "Diarize missing speech chunks" },
        });
      }
      const health = await callResource("jobs", {
        action: "pipeline_health",
        force: true,
      }) as any;
      const service = health.services?.find((item: any) =>
        item.id === "diarizator"
      );
      const metadata = service?.metadata;
      if (
        service?.status !== "healthy" || !metadata?.embeddingSpaceId ||
        !metadata?.diarizationFingerprint
      ) {
        throw new Error(
          "Healthy diarizator with runtime fingerprint is required",
        );
      }
      const runId = `diar-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await callResource("speaker-segments", {
        action: "create-run",
        runId,
        mode: "rediarize",
        generation: Math.max(0, ...runs.map((run) => run.generation)) + 1,
        ...range,
        replacesRunId: activeRun?.runId,
        diarizationFingerprint: metadata.diarizationFingerprint,
        embeddingSpaceId: metadata.embeddingSpaceId,
      });
      return await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "diarization",
          mode: "build_generation",
          runId,
          ...range,
          limit: 4,
        },
        trigger: {
          type: "manual",
          reason: `Build diarization generation ${runId}`,
        },
      });
    },
    onSuccess: () => {
      toast.success("Voice Identity operation queued");
      void queryClient.invalidateQueries({ queryKey: ["speaker-runs"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Operation failed"),
  });

  const runAction = useMutation({
    mutationFn: async (
      { action, runId }: {
        action:
          | "compare-run"
          | "activate-run"
          | "preview-purge"
          | "purge-superseded";
        runId: string;
      },
    ) => {
      if (action === "purge-superseded") {
        const confirmation = window.prompt(
          `Type PURGE ${runId} to delete only superseded diarization documents.`,
        );
        if (!confirmation) return null;
        return await callResource("speaker-segments", {
          action,
          runId,
          confirmation,
        });
      }
      const result = await callResource("speaker-segments", { action, runId });
      if (action === "compare-run" || action === "preview-purge") {
        window.alert(JSON.stringify(result, null, 2));
      }
      return result;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["speaker-runs"] }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Run action failed"),
  });

  return (
    <Card data-testid="voice-identity-operations">
      <CardHeader>
        <CardTitle>Voice Identity — Sky first</CardTitle>
        <CardDescription>
          Cheap classification uses stored embeddings. Re-diarization creates a
          separate generation and never replaces active data before activation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {[24, 24 * 7, 24 * 14, 24 * 30].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={hours === value ? "default" : "outline"}
              onClick={() => setHours(value)}
            >
              {value === 24 ? "24 hours" : `${value / 24} days`}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            Primary: {primary?.name ?? "none"} · calibration:{" "}
            {calibration?.calibrationId ?? "not validated"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => operation.mutate("classify")}
            disabled={operation.isPending || !calibration}
          >
            Classify existing
          </Button>
          <Button
            variant="outline"
            onClick={() => operation.mutate("missing")}
            disabled={operation.isPending}
          >
            Diarize missing
          </Button>
          <Button
            variant="outline"
            onClick={() => operation.mutate("rediarize")}
            disabled={operation.isPending}
          >
            Re-diarize range
          </Button>
          <Link
            to={`/transcript?start=${range.start.getTime()}&end=${range.end.getTime()}`}
          >
            <Button variant="ghost">Open transcript</Button>
          </Link>
        </div>
        <div className="space-y-2">
          {runs.slice(0, 8).map((run) => (
            <div
              key={run.runId}
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              <span className="font-mono text-xs">{run.runId}</span>
              <Badge variant="outline">{run.status}</Badge>
              <span className="text-xs text-muted-foreground">
                gen {run.generation} · {run.embeddingSpaceId}
              </span>
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    runAction.mutate({
                      action: "compare-run",
                      runId: run.runId,
                    })}
                >
                  Compare
                </Button>
                {run.status === "ready" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      runAction.mutate({
                        action: "activate-run",
                        runId: run.runId,
                      })}
                  >
                    Activate
                  </Button>
                )}
                {run.status === "superseded" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      runAction.mutate({
                        action: "activate-run",
                        runId: run.runId,
                      })}
                  >
                    Rollback to
                  </Button>
                )}
                {(run.status === "superseded" || run.status === "failed") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      runAction.mutate({
                        action: "preview-purge",
                        runId: run.runId,
                      })}
                  >
                    Preview purge
                  </Button>
                )}
                {run.status === "superseded" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      runAction.mutate({
                        action: "purge-superseded",
                        runId: run.runId,
                      })}
                  >
                    Purge
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
