import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Unlink, UserRound } from "lucide-react";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import {
  buildSpeakerAssignmentQuery,
  normalizeSpeakerEmbedding,
  type SpeakerAssignmentScope,
} from "@/lib/speakerAssignment";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpeakerBadge } from "./SpeakerBadge";

const PROFILE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export interface SpeakerProfileOption {
  _id: unknown;
  name: string;
  color?: string;
  is_primary?: boolean;
}

export interface MatchedSpeakerValue {
  profile_id: unknown;
  name: string;
  similarity?: number;
  method?: string;
}

interface SpeakerAssignmentControlProps {
  segmentId: unknown;
  originalId?: unknown;
  speaker?: string;
  embedding?: number[];
  duration?: number;
  matchedSpeaker?: MatchedSpeakerValue;
  onChanged: (matchedSpeaker?: MatchedSpeakerValue) => void;
}

export function SpeakerAssignmentControl({
  segmentId,
  originalId,
  speaker,
  embedding,
  duration = 0,
  matchedSpeaker,
  onChanged,
}: SpeakerAssignmentControlProps) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<SpeakerAssignmentScope>("segment");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["speaker_profiles"],
    queryFn: async () => {
      const result = await callResource("mongo", {
        action: "find",
        collection: "speaker_profiles",
        query: {},
        options: { sort: { is_primary: -1, name: 1 } },
      });
      return (Array.isArray(result) ? result : []) as SpeakerProfileOption[];
    },
  });

  const canAssignSpeakerGroup = Boolean(
    normalizeObjectId(originalId) && speaker,
  );
  const currentProfileId = normalizeObjectId(matchedSpeaker?.profile_id) ?? "";

  useEffect(() => {
    setSelectedProfileId(currentProfileId);
  }, [currentProfileId]);

  useEffect(() => {
    if (!canAssignSpeakerGroup && scope === "speaker") setScope("segment");
  }, [canAssignSpeakerGroup, scope]);

  const selectedProfile = useMemo(
    () =>
      profiles.find((profile) =>
        normalizeObjectId(profile._id) === selectedProfileId
      ),
    [profiles, selectedProfileId],
  );

  const assignmentQuery = () =>
    buildSpeakerAssignmentQuery({
      id: segmentId,
      originalId,
      speaker,
    }, scope);

  const updateAssignment = async (profile?: SpeakerProfileOption) => {
    setSaving(true);
    try {
      const query = assignmentQuery();
      const action = scope === "segment" ? "updateOne" : "updateMany";
      const matched = profile
        ? {
          profile_id: { $oid: normalizeObjectId(profile._id)! },
          name: profile.name,
          similarity: 1,
          matched_at: new Date(),
          method: "manual",
        }
        : undefined;

      await callResource("mongo", {
        action,
        collection: "diarizations",
        query,
        update: matched
          ? { $set: { matched_speaker: matched } }
          : { $unset: { matched_speaker: "" } },
      });

      setSelectedProfileId(profile ? normalizeObjectId(profile._id)! : "");
      onChanged(matched);
      toast.success(
        profile ? `Assigned ${profile.name}` : "Speaker assignment cleared",
        {
          description: scope === "speaker"
            ? `Applied to all ${speaker} segments in this recording.`
            : "Applied to this segment only.",
        },
      );
    } catch (error) {
      toast.error("Could not update speaker assignment", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const createProfile = async () => {
    const name = newProfileName.trim();
    if (!name || !embedding?.length) return;

    setSaving(true);
    try {
      const now = new Date();
      const profile = {
        name,
        embedding: normalizeSpeakerEmbedding(embedding),
        sample_count: 1,
        total_duration: duration,
        is_primary: false,
        color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
        source: "diarization_segment",
        created_at: now,
        updated_at: now,
      };
      const result = await callResource("mongo", {
        action: "insertOne",
        collection: "speaker_profiles",
        doc: profile,
      });
      const insertedId = normalizeObjectId(result?.insertedId);
      if (!insertedId) {
        throw new Error("Speaker profile was created without an ID");
      }

      const createdProfile = { ...profile, _id: { $oid: insertedId } };
      await queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
      setCreateOpen(false);
      setNewProfileName("");
      await updateAssignment(createdProfile);
    } catch (error) {
      toast.error("Could not create speaker profile", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {matchedSpeaker
          ? (
            <SpeakerBadge
              name={matchedSpeaker.name}
              similarity={matchedSpeaker.similarity}
              color={selectedProfile?.color}
              showIcon
            />
          )
          : (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4" />
              Unassigned ({speaker ?? "unknown speaker"})
            </span>
          )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
        <Select
          value={selectedProfileId || undefined}
          onValueChange={setSelectedProfileId}
          disabled={isLoading || saving}
        >
          <SelectTrigger aria-label="Select speaker profile">
            <SelectValue
              placeholder={isLoading ? "Loading speakers..." : "Select speaker"}
            />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => {
              const profileId = normalizeObjectId(profile._id)!;
              return (
                <SelectItem key={profileId} value={profileId}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: profile.color ?? "#6b7280" }}
                    />
                    {profile.name}
                    {profile.is_primary ? " (My voice)" : ""}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={scope}
          onValueChange={(value) => setScope(value as SpeakerAssignmentScope)}
        >
          <SelectTrigger aria-label="Assignment scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="segment">This segment only</SelectItem>
            <SelectItem value="speaker" disabled={!canAssignSpeakerGroup}>
              All {speaker ?? "speaker"} segments
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => selectedProfile && updateAssignment(selectedProfile)}
          disabled={!selectedProfile || saving ||
            selectedProfileId === currentProfileId}
        >
          {saving
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <Check className="mr-2 h-4 w-4" />}
          Assign
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => updateAssignment()}
          disabled={!matchedSpeaker || saving}
        >
          <Unlink className="mr-2 h-4 w-4" />
          Clear
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreateOpen(true)}
          disabled={!embedding?.length || saving}
        >
          <Plus className="mr-2 h-4 w-4" />
          New speaker from segment
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create speaker from this segment</DialogTitle>
            <DialogDescription>
              The segment embedding becomes the initial voice profile and is
              assigned using the selected scope.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="segment-speaker-name">Speaker name</Label>
            <Input
              id="segment-speaker-name"
              value={newProfileName}
              onChange={(event) => setNewProfileName(event.target.value)}
              placeholder="e.g. Alice"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={createProfile}
              disabled={!newProfileName.trim() || saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create and assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
