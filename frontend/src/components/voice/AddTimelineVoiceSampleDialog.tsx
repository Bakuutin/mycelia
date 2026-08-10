import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient, callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import {
  buildTimelineSampleMetadata,
  type VoiceProfileAttachTarget,
} from "@/lib/voiceProfiles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProfileDocument {
  _id: unknown;
  name: string;
  is_primary?: boolean;
}

const getProfileDocumentId = (profile: ProfileDocument) =>
  normalizeObjectId(profile._id) ?? "";

interface AddTimelineVoiceSampleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: Date;
  endDate: Date;
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

export function AddTimelineVoiceSampleDialog({
  open,
  onOpenChange,
  startDate,
  endDate,
}: AddTimelineVoiceSampleDialogProps) {
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const durationSeconds = Math.max(
    0,
    (endDate.getTime() - startDate.getTime()) / 1000,
  );
  const rangeProblem = durationSeconds < 3
    ? "Select at least 3 seconds of clear speech."
    : durationSeconds > 120
    ? "Select no more than 2 minutes; 10–30 seconds of one clear speaker works best."
    : null;

  const { data: profiles = [], isLoading, error } = useQuery<ProfileDocument[]>(
    {
      queryKey: ["speaker_profiles", "timeline-sample"],
      enabled: open,
      queryFn: () =>
        callResource("mongo", {
          action: "find",
          collection: "speaker_profiles",
          query: {},
          options: { sort: { is_primary: -1, name: 1 } },
        }) as Promise<ProfileDocument[]>,
    },
  );

  useEffect(() => {
    if (!open || profileId || profiles.length === 0) return;
    const preferred = profiles.find((profile) => profile.is_primary) ??
      profiles[0];
    setProfileId(getProfileDocumentId(preferred));
  }, [open, profileId, profiles]);

  const selectedProfile = useMemo(() => {
    const profile = profiles.find((item) =>
      getProfileDocumentId(item) === profileId
    );
    if (!profile) return null;
    return {
      id: profileId,
      name: profile.name,
      isPrimary: Boolean(profile.is_primary),
    } satisfies VoiceProfileAttachTarget;
  }, [profileId, profiles]);

  const addSample = useMutation({
    mutationFn: async () => {
      if (!selectedProfile || rangeProblem) {
        throw new Error(rangeProblem ?? "Choose a voice profile.");
      }
      const query = new URLSearchParams({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      });
      const wav = await apiClient.getBlob(`/api/audio/wav?${query}`);
      const uploaded = await apiClient.post<{ file_id: string }>(
        "/api/files/upload",
        {
          file: await blobToBase64(wav),
          filename: `timeline_voice_${startDate.toISOString()}.wav`,
          mimetype: "audio/wav",
          bucket: "voice_samples",
          metadata: buildTimelineSampleMetadata(
            selectedProfile,
            startDate,
            endDate,
          ),
        },
      );
      if (!uploaded.file_id) throw new Error("Audio sample was not saved.");
      return await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "enrollment",
          name: selectedProfile.name,
          profile_id: selectedProfile.id,
          is_primary: selectedProfile.isPrimary,
          sample_file_id: uploaded.file_id,
        },
        trigger: {
          type: "manual",
          reason: "Add Timeline selection to voice profile",
        },
      });
    },
    onSuccess: () => {
      toast.success("Voice sample saved; profile rebuild queued", {
        description: "Track the enrollment job on the Jobs page.",
      });
      void queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      onOpenChange(false);
    },
    onError: (mutationError) =>
      toast.error("Could not add Timeline sample", {
        description: mutationError instanceof Error
          ? mutationError.message
          : "Unknown error",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add selection as voice sample</DialogTitle>
          <DialogDescription>
            Saves this audio clip in the selected profile, then rebuilds that
            profile embedding. The source interval stays attached for review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div>{startDate.toLocaleString()}</div>
            <div>{endDate.toLocaleString()}</div>
            <div className="mt-1 text-muted-foreground">
              {durationSeconds.toFixed(1)} seconds selected
            </div>
          </div>
          <div className="space-y-2">
            <Label>Voice profile</Label>
            <Select
              value={profileId}
              onValueChange={setProfileId}
              disabled={isLoading || addSample.isPending}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={isLoading
                    ? "Loading profiles…"
                    : "Select profile"}
                />
              </SelectTrigger>
              <SelectContent>
                {profiles.filter(getProfileDocumentId).map((profile) => (
                  <SelectItem
                    key={getProfileDocumentId(profile)}
                    value={getProfileDocumentId(profile)}
                  >
                    {profile.name}
                    {profile.is_primary ? " — My Voice" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(rangeProblem || error || (!isLoading && profiles.length === 0)) && (
            <p className="text-sm text-destructive">
              {rangeProblem ?? (error
                ? "Voice profiles could not be loaded."
                : "Create a voice profile first.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addSample.mutate()}
            disabled={addSample.isPending || !selectedProfile ||
              Boolean(rangeProblem)}
          >
            {addSample.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {addSample.isPending ? "Saving audio…" : "Save and rebuild profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
