import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, UserRound } from "lucide-react";
import { normalizeObjectId } from "@/lib/diarization";
import {
  loadVoiceIdentityStatus,
  loadVoiceProfiles,
  voiceIdentityKeys,
} from "@/lib/voiceIdentity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function VoiceIdentityStatusCard() {
  const profilesQuery = useQuery({
    queryKey: voiceIdentityKeys.profiles,
    queryFn: loadVoiceProfiles,
    staleTime: 30_000,
  });
  const primary = profilesQuery.data?.find((profile) => profile.is_primary);
  const primaryId = normalizeObjectId(primary?._id);
  const statusQuery = useQuery({
    queryKey: voiceIdentityKeys.status(primaryId),
    enabled: Boolean(primaryId),
    queryFn: () => loadVoiceIdentityStatus(primaryId!),
    refetchInterval: (query) => {
      if (document.visibilityState !== "visible") return false;
      const campaign = query.state.data?.latestCampaign?.status;
      return campaign && ["queued", "counting", "running"].includes(campaign)
        ? 10_000
        : false;
    },
  });
  const status = statusQuery.data;
  const calibrationPolicy = status?.usableCalibration
    ? status.usableCalibration.classificationPolicy ??
      (status.usableCalibration.targetPrecision >= 0.98 ? "full" : "pilot")
    : null;

  return (
    <Card data-testid="voice-identity-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5 text-primary" />
          Voice identity
        </CardTitle>
        <CardDescription>
          Identify Sky in already diarized audio. Calibration teaches the
          matcher which similarity scores mean Sky, not Sky, or uncertain; it
          does not rerun diarization.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {profilesQuery.isLoading || (primaryId && statusQuery.isLoading)
          ? (
            <p className="text-sm text-muted-foreground">
              Loading identity readiness…
            </p>
          )
          : !primaryId
          ? (
            <p className="text-sm text-amber-600">
              No primary voice profile is configured.
            </p>
          )
          : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">Primary: {primary?.name}</Badge>
              <Badge variant="outline">
                Revision {status?.profile?.revision ?? primary?.revision ?? 1}
              </Badge>
              <Badge
                className={status?.canClassify
                  ? "bg-green-500/10 text-green-600"
                  : "bg-amber-500/10 text-amber-600"}
              >
                {status?.canClassify
                  ? calibrationPolicy === "pilot"
                    ? "24h pilot ready"
                    : "Ready to classify"
                  : "Calibration needed"}
              </Badge>
              {status?.latestCampaign && (
                <Badge variant="secondary">
                  Backfill {status.latestCampaign.status.replaceAll("_", " ")}
                </Badge>
              )}
            </div>
          )}
        {primaryId && statusQuery.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Voice identity readiness could not be loaded. Open calibration to
            inspect the profile and try again.
          </div>
        )}
        {status?.canClassify && calibrationPolicy === "pilot" && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            Provisional calibration at {Math.round(
              (status.usableCalibration?.targetPrecision ?? 0) * 100,
            )}% is ready for a maximum 24-hour pilot. Review its false matches,
            then return to calibration and reach 98% before historical
            classification.
          </div>
        )}
        {primaryId && !statusQuery.isLoading && !statusQuery.isError &&
          !status?.canClassify && (
          <div
            className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
            data-testid="voice-identity-calibration-needed"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Calibrate {primary?.name ?? "the primary voice"}{" "}
                  before classification
                </p>
                <p className="text-xs text-muted-foreground">
                  Review clear Sky / not-Sky examples, use different recordings
                  to fit and check the thresholds, then save the validated
                  calibration. You choose the required precision; the server
                  recalculates the actual thresholds and shows the resulting
                  coverage and false matches.
                </p>
              </div>
            </div>
            {(status?.blockers?.length ?? 0) > 0 && (
              <div className="text-xs">
                <p className="font-medium">Current blockers</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {status?.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="sm">
                <Link to="/settings/voice-identity#calibration">
                  Open calibration setup
                </Link>
              </Button>
              <span className="text-xs text-muted-foreground">
                Next: label → fit → validate → save → classify
              </span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-sm font-medium">
          <Link
            className="text-primary hover:underline"
            to="/settings/voice-profiles"
          >
            Profiles & samples →
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/settings/voice-identity#calibration"
          >
            Calibration details →
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/settings/voice-identity/operations"
          >
            Operations & generations →
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/jobs?type=speakerIdentity"
          >
            Identity jobs →
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/jobs?type=diarization"
          >
            Diarization jobs →
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/settings/diarization"
          >
            Diarization servers →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
