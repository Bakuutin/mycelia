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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { voiceIdentityKeys } from "@/lib/voiceIdentity";

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
  originalId?: string;
  source?: "timeline_selection" | "review_selection";
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
  originalId,
  source = "timeline_selection",
}: AddTimelineVoiceSampleDialogProps) {
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const [profileMode, setProfileMode] = useState<"existing" | "new">(
    "existing",
  );
  const [newProfileName, setNewProfileName] = useState("");
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

  useEffect(() => {
    if (open && !isLoading && profiles.length === 0) setProfileMode("new");
  }, [isLoading, open, profiles.length]);

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
      if (rangeProblem) throw new Error(rangeProblem);
      let target = selectedProfile;
      let createdProfile = false;
      if (profileMode === "new") {
        const name = newProfileName.trim();
        if (!name) throw new Error("Enter a name for the new speaker.");
        const profile = await callResource("speaker-segments", {
          action: "create-profile",
          name,
        }) as ProfileDocument;
        const id = getProfileDocumentId(profile);
        if (!id) throw new Error("New speaker profile has no valid ID.");
        target = { id, name: profile.name, isPrimary: false };
        createdProfile = true;
      }
      if (!target) {
        throw new Error("Choose a voice profile or create a new speaker.");
      }
      try {
        const query = new URLSearchParams({
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        });
        if (originalId) query.set("original_id", originalId);
        const wav = await apiClient.getBlob(`/api/audio/wav?${query}`);
        const uploaded = await apiClient.post<{ file_id: string }>(
          "/api/files/upload",
          {
            file: await blobToBase64(wav),
            filename: `timeline_voice_${startDate.toISOString()}.wav`,
            mimetype: "audio/wav",
            bucket: "voice_samples",
            metadata: buildTimelineSampleMetadata(
              target,
              startDate,
              endDate,
              source,
            ),
          },
        );
        if (!uploaded.file_id) throw new Error("Audio sample was not saved.");
        return await callResource("jobs", {
          action: "enqueue",
          data: {
            type: "enrollment",
            name: target.name,
            profile_id: target.id,
            is_primary: target.isPrimary,
            sample_file_id: uploaded.file_id,
          },
          trigger: {
            type: "manual",
            reason: "Add Timeline selection to voice profile",
          },
        });
      } catch (error) {
        if (createdProfile) {
          throw new Error(
            `${target.name} was created, but its audio sample was not queued. Select the existing profile and retry. ${
              error instanceof Error ? error.message : ""
            }`.trim(),
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Voice sample saved; profile rebuild queued", {
        description: "Track the enrollment job on the Jobs page.",
      });
      void queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      void queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
      void queryClient.invalidateQueries({
        queryKey: ["speaker_profiles", "timeline-sample"],
      });
      setNewProfileName("");
      setProfileMode("existing");
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
            <Label>Speaker</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={profileMode === "existing" ? "default" : "outline"}
                onClick={() => setProfileMode("existing")}
                disabled={profiles.length === 0 || addSample.isPending}
              >
                Existing profile
              </Button>
              <Button
                type="button"
                variant={profileMode === "new" ? "default" : "outline"}
                onClick={() => setProfileMode("new")}
                disabled={addSample.isPending}
              >
                New speaker
              </Button>
            </div>
            {profileMode === "existing"
              ? (
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
              )
              : (
                <Input
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  placeholder="Speaker name, e.g. Andrew Kislov"
                  disabled={addSample.isPending}
                  aria-label="New speaker name"
                  autoFocus
                />
              )}
          </div>
          {(rangeProblem || error) && (
            <p className="text-sm text-destructive">
              {rangeProblem ?? "Voice profiles could not be loaded."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addSample.mutate()}
            disabled={addSample.isPending || Boolean(rangeProblem) ||
              (profileMode === "existing"
                ? !selectedProfile
                : !newProfileName.trim())}
          >
            {addSample.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {addSample.isPending
              ? "Saving audio…"
              : profileMode === "new"
              ? "Create speaker and save sample"
              : "Save and rebuild profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
