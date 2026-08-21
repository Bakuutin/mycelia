import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { normalizeObjectId } from "@/lib/diarization";
import {
  loadVoiceIdentityStatus,
  loadVoiceProfiles,
  voiceIdentityKeys,
} from "@/lib/voiceIdentity";
import { Badge } from "@/components/ui/badge";
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

  return (
    <Card data-testid="voice-identity-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5 text-primary" />
          Voice identity
        </CardTitle>
        <CardDescription>
          Sky-first identity is configured in Settings. Classification reuses
          stored embeddings; re-diarization remains an isolated generation.
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
                  ? "Ready to classify"
                  : "Calibration needed"}
              </Badge>
              {status?.latestCampaign && (
                <Badge variant="secondary">
                  Backfill {status.latestCampaign.status.replaceAll("_", " ")}
                </Badge>
              )}
            </div>
          )}
        {(status?.blockers?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            {status?.blockers.join(" · ")}
          </p>
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
            to="/settings/voice-identity"
          >
            Review & calibration →
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
