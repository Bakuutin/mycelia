import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function VoiceIdentityReviewPage() {
  const queryClient = useQueryClient();
  const [positive, setPositive] = useState(0.7);
  const [negative, setNegative] = useState(0.35);
  const [precision, setPrecision] = useState(0.98);
  const [skyCount, setSkyCount] = useState(40);
  const [notSkyCount, setNotSkyCount] = useState(40);
  const [borderlineCount, setBorderlineCount] = useState(20);
  const [calibrationRecordings, setCalibrationRecordings] = useState("");
  const [validationRecordings, setValidationRecordings] = useState("");
  const range = {
    start: new Date(Date.now() - 14 * 86_400_000),
    end: new Date(),
  };

  const { data: profiles = [] } = useQuery<any[]>({
    queryKey: ["speaker_profiles"],
    queryFn: () =>
      callResource("mongo", {
        action: "find",
        collection: "speaker_profiles",
        query: {},
        options: { sort: { is_primary: -1 } },
      }) as Promise<any[]>,
  });
  const primary = profiles.find((profile) => profile.is_primary);
  const profileId = normalizeObjectId(primary?._id);
  const { data: queue = [], isLoading } = useQuery<any[]>({
    queryKey: ["speaker-review", range.start.getTime(), range.end.getTime()],
    queryFn: () =>
      callResource("speaker-segments", {
        action: "review-queue",
        ...range,
        state: "uncertain",
        limit: 100,
      }) as Promise<any[]>,
  });

  const label = useMutation({
    mutationFn: async (
      { segment, state }: { segment: any; state: "me" | "not-me" },
    ) => {
      if (!profileId) throw new Error("Primary profile is missing");
      const segmentId = normalizeObjectId(segment._id);
      const originalId = normalizeObjectId(
        segment.original_id ?? segment.original,
      );
      if (!segmentId || !originalId) {
        throw new Error("Segment identity is incomplete");
      }
      if (state === "me") {
        return await callResource("speaker-segments", {
          action: "assign",
          segmentId,
          scope: "segment",
          profileId,
        });
      }
      return await callResource("speaker-segments", {
        action: "annotate",
        originalId,
        segmentId,
        runId: segment.runId,
        start: segment.start,
        end: segment.end,
        excludedProfileIds: [profileId],
      });
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["speaker-review"] }),
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not label segment",
      ),
  });

  const saveCalibration = useMutation({
    mutationFn: async () => {
      if (!profileId || !primary?.embeddingSpaceId) {
        throw new Error(
          "Primary profile has no embedding provenance; re-enroll it first",
        );
      }
      const split = (value: string) =>
        value.split(",").map((item) => item.trim()).filter(Boolean);
      return await callResource("speaker-segments", {
        action: "save-calibration",
        calibrationId: `sky-r${primary.revision ?? 1}-${Date.now()}`,
        profileId,
        profileRevision: primary.revision ?? 1,
        embeddingSpaceId: primary.embeddingSpaceId,
        positiveThreshold: positive,
        negativeThreshold: negative,
        metrics: {
          precision,
          sky: skyCount,
          notSky: notSkyCount,
          borderline: borderlineCount,
        },
        calibrationRecordingIds: split(calibrationRecordings),
        validationRecordingIds: split(validationRecordings),
        status: "validated",
        allowLegacyCompatibility: primary.embeddingSpaceId === "legacy-unknown",
      });
    },
    onSuccess: () =>
      toast.success(
        "Validated calibration saved; historical classification is unblocked",
      ),
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Calibration rejected",
      ),
  });
  const reenroll = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("Primary profile is missing");
      return await callResource("jobs", {
        action: "enqueue",
        data: { type: "profileReenrollment", profileId },
        trigger: {
          type: "manual",
          reason: "Rebuild primary voice profile from saved samples",
        },
      });
    },
    onSuccess: () =>
      toast.success("Sky re-enrollment queued from all saved samples"),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not queue re-enrollment",
      ),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Voice Identity review</h2>
          <p className="text-muted-foreground">
            Review the uncertain band first, then lock thresholds on separate
            validation recordings.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => reenroll.mutate()}
          disabled={!profileId || reenroll.isPending}
        >
          Re-enroll Sky from saved samples
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Uncertain segments — last 14 days</CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading…"
              : `${queue.length} segments ready for review`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {queue.map((segment) => {
            const id = normalizeObjectId(segment._id)!;
            return (
              <div
                key={id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
              >
                <Link
                  className="font-mono text-primary hover:underline"
                  to={`/diarizations/${id}`}
                >
                  {new Date(segment.start).toLocaleString()}
                </Link>
                <span>
                  {Math.round(
                    (segment.speakerIdentity?.primaryScore ?? 0) * 100,
                  )}%
                </span>
                <Button
                  size="sm"
                  onClick={() => label.mutate({ segment, state: "me" })}
                >
                  This is me
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => label.mutate({ segment, state: "not-me" })}
                >
                  Not me
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Validate Sky calibration</CardTitle>
          <CardDescription>
            Server enforces ≥100 labels, at least 40 Sky and 40 not-Sky, ≥98%
            precision, disjoint calibration/validation recordings, and negative
            threshold below positive.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Positive threshold<Input
              type="number"
              step="0.01"
              value={positive}
              onChange={(e) => setPositive(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Negative threshold<Input
              type="number"
              step="0.01"
              value={negative}
              onChange={(e) => setNegative(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Measured precision<Input
              type="number"
              step="0.001"
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Sky labels<Input
              type="number"
              value={skyCount}
              onChange={(e) => setSkyCount(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Not-Sky labels<Input
              type="number"
              value={notSkyCount}
              onChange={(e) => setNotSkyCount(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Borderline labels<Input
              type="number"
              value={borderlineCount}
              onChange={(e) => setBorderlineCount(Number(e.target.value))}
            />
          </label>
          <label className="text-sm md:col-span-3">
            Calibration recording IDs (comma-separated)<Input
              value={calibrationRecordings}
              onChange={(e) => setCalibrationRecordings(e.target.value)}
            />
          </label>
          <label className="text-sm md:col-span-3">
            Validation recording IDs (comma-separated)<Input
              value={validationRecordings}
              onChange={(e) => setValidationRecordings(e.target.value)}
            />
          </label>
          <Button
            className="md:col-span-3"
            onClick={() => saveCalibration.mutate()}
            disabled={saveCalibration.isPending}
          >
            Save validated calibration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
