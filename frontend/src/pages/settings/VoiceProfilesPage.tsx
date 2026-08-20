import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, callResource } from "@/lib/api";
import { convertBlobToWav } from "@/lib/audioUtils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileAudio,
  Loader2,
  Mic,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Unlink,
  Upload,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { WaveformPlayer } from "@/components/audio/WaveformPlayer";
import { useJobsListener } from "@/hooks/useJobsListener";
import {
  buildAttachSampleOperations,
  summarizeVoiceSamples,
} from "@/lib/voiceProfiles";
import { ServiceHealthBanner } from "@/components/ServiceHealthBanner";
import { voiceIdentityKeys } from "@/lib/voiceIdentity";

const VOICE_SAMPLES_BUCKET = "voice_samples";

// Pre-defined colors for speaker profiles
const PROFILE_COLORS = [
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#10b981", // Green
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
];

// Helper to extract ID string from EJSON ObjectId or plain string
const getSampleId = (sample: VoiceSample): string => {
  if (typeof sample._id === "string") return sample._id;
  if (sample._id && typeof sample._id === "object" && "$oid" in sample._id) {
    return sample._id.$oid;
  }
  return String(sample._id);
};

const getProfileId = (profile: SpeakerProfile): string => {
  if (typeof profile._id === "string") return profile._id;
  if (
    profile._id && typeof profile._id === "object" &&
    "$oid" in (profile._id as object)
  ) {
    return (profile._id as { $oid: string }).$oid;
  }
  return String(profile._id);
};

interface SpeakerProfile {
  _id: string | { $oid: string };
  name: string;
  sample_count: number;
  total_duration: number;
  is_primary: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

interface VoiceSample {
  _id: { $oid: string } | string;
  filename: string;
  metadata?: {
    speaker_name?: string;
    duration?: number;
    uploaded_at?: string;
    profile_id?: string;
    source?: string;
    source_start?: string;
    source_end?: string;
  };
  length: number;
}

interface EnrollmentJobData {
  type: "enrollment";
  name: string;
  is_primary: boolean;
  audio_data_base64?: string;
  sample_file_id?: string;
  profile_id?: string;
}

const VoiceProfilesPage = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sampleTargetProfile, setSampleTargetProfile] = useState<
    SpeakerProfile | null
  >(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(
    new Set(),
  );

  // Edit profile state
  const [editingProfile, setEditingProfile] = useState<SpeakerProfile | null>(
    null,
  );
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIsPrimary, setEditIsPrimary] = useState(false);

  // Delete sample warning state
  const [deletingSample, setDeletingSample] = useState<
    { sampleId: string; profileId: string } | null
  >(null);

  // Attach sample state
  const [attachingSample, setAttachingSample] = useState<VoiceSample | null>(
    null,
  );
  const [attachToProfileId, setAttachToProfileId] = useState<string>("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useJobsListener({
    types: ["enrollment", "profileReenrollment"],
    onJobFinished: () => {
      void queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
      void queryClient.invalidateQueries({
        queryKey: ["speaker-identity-status"],
      });
      void queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
    },
  });

  // Fetch speaker profiles
  const { data: profiles, isLoading } = useQuery({
    queryKey: voiceIdentityKeys.profiles,
    queryFn: async () => {
      const result = await callResource("mongo", {
        action: "find",
        collection: "speaker_profiles",
        query: {},
        options: { sort: { created_at: 1 } },
      });
      return (Array.isArray(result) ? result : []) as SpeakerProfile[];
    },
  });

  // Fetch saved voice samples from GridFS
  const { data: savedSamples } = useQuery({
    queryKey: ["voice_samples"],
    queryFn: async () => {
      const result = await callResource("fs", {
        action: "find",
        bucket: VOICE_SAMPLES_BUCKET,
        query: {},
      });
      return (result || []) as VoiceSample[];
    },
  });

  // Get samples attached to a profile
  const getProfileSamples = (profileId: string) => {
    return savedSamples?.filter((s) => s.metadata?.profile_id === profileId) ||
      [];
  };

  // Get unattached samples
  const unattachedSamples =
    savedSamples?.filter((s) => !s.metadata?.profile_id) || [];

  // Enrollment mutation
  const enrollMutation = useMutation({
    mutationFn: async (data: EnrollmentJobData) => {
      return await callResource("jobs", {
        action: "enqueue",
        data: data,
      });
    },
    onSuccess: () => {
      toast.success("Voice enrollment started", {
        description:
          "Your voice profile is being created. This may take a few seconds.",
      });
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error("Enrollment failed", { description: error.message });
    },
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (
      { profileId, name, color, is_primary }: {
        profileId: string;
        name?: string;
        color?: string;
        is_primary?: boolean;
      },
    ) => {
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (name !== undefined) update.name = name;
      if (color !== undefined) update.color = color;
      if (is_primary !== undefined) {
        if (is_primary) {
          // Unset other primary profiles first
          await callResource("mongo", {
            action: "updateMany",
            collection: "speaker_profiles",
            query: { is_primary: true, _id: { $ne: { $oid: profileId } } },
            update: { $set: { is_primary: false } },
          });
        }
        update.is_primary = is_primary;
      }
      await callResource("mongo", {
        action: "updateOne",
        collection: "speaker_profiles",
        query: { _id: { $oid: profileId } },
        update: { $set: update },
      });
    },
    onSuccess: () => {
      toast.success("Profile updated");
      queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
      setEditingProfile(null);
    },
    onError: (error: Error) => {
      toast.error("Update failed", { description: error.message });
    },
  });

  // Delete sample mutation (for unattached samples)
  const deleteSampleMutation = useMutation({
    mutationFn: async (sampleId: string) => {
      await callResource("mongo", {
        action: "deleteOne",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { _id: { $oid: sampleId } },
      });
      await callResource("mongo", {
        action: "deleteMany",
        collection: `${VOICE_SAMPLES_BUCKET}.chunks`,
        query: { files_id: { $oid: sampleId } },
      });
    },
    onSuccess: () => {
      toast.success("Sample deleted");
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
    },
    onError: (error: Error) => {
      toast.error("Failed to delete sample", { description: error.message });
    },
  });

  const invalidateAndRebuildProfile = async (
    profileId: string,
    sampleCount: number,
  ) => {
    const profile = await callResource("mongo", {
      action: "findOne",
      collection: "speaker_profiles",
      query: { _id: { $oid: profileId } },
      options: { projection: { revision: 1 } },
    }) as { revision?: number } | null;
    if (!profile) throw new Error("Voice profile no longer exists");
    await callResource("mongo", {
      action: "updateOne",
      collection: "speaker_profiles",
      query: { _id: { $oid: profileId } },
      update: {
        $set: {
          revision: (profile.revision ?? 1) + 1,
          sample_count: sampleCount,
          enrollmentStatus: "pending_rebuild",
          updated_at: new Date().toISOString(),
        },
        $unset: { embedding: "" },
      },
    });
    return await callResource("jobs", {
      action: "enqueue",
      data: { type: "profileReenrollment", profileId },
      trigger: {
        type: "manual",
        reason: "Rebuild voice profile after removing a saved sample",
      },
    });
  };

  // Delete attached sample mutation (with profile update)
  const deleteAttachedSampleMutation = useMutation({
    mutationFn: async (
      { sampleId, profileId }: { sampleId: string; profileId: string },
    ) => {
      // Delete the sample
      await callResource("mongo", {
        action: "deleteOne",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { _id: { $oid: sampleId } },
      });
      await callResource("mongo", {
        action: "deleteMany",
        collection: `${VOICE_SAMPLES_BUCKET}.chunks`,
        query: { files_id: { $oid: sampleId } },
      });

      // Check remaining samples for this profile
      const remainingSamples = await callResource("mongo", {
        action: "find",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { "metadata.profile_id": profileId },
      });

      const remaining = Array.isArray(remainingSamples) ? remainingSamples : [];

      if (remaining.length === 0) {
        // Delete the profile if no samples remain
        await callResource("mongo", {
          action: "deleteOne",
          collection: "speaker_profiles",
          query: { _id: { $oid: profileId } },
        });
        toast.info("Profile deleted (no samples remaining)");
      } else {
        await invalidateAndRebuildProfile(profileId, remaining.length);
      }
    },
    onSuccess: () => {
      toast.success("Sample deleted");
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
      setDeletingSample(null);
    },
    onError: (error: Error) => {
      toast.error("Failed to delete sample", { description: error.message });
    },
  });

  // Delete profile mutation
  const deleteMutation = useMutation({
    mutationFn: async (profileId: string) => {
      await callResource("mongo", {
        action: "updateMany",
        collection: "diarizations",
        query: { "matched_speaker.profile_id": { $oid: profileId } },
        update: { $unset: { matched_speaker: "" } },
      });
      await callResource("mongo", {
        action: "updateMany",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { "metadata.profile_id": profileId },
        update: { $unset: { "metadata.profile_id": "" } },
      });
      await callResource("mongo", {
        action: "deleteOne",
        collection: "speaker_profiles",
        query: { _id: { $oid: profileId } },
      });
    },
    onSuccess: () => {
      toast.success("Profile deleted", {
        description:
          "Existing segment assignments were cleared and voice samples were detached.",
      });
      queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
    },
    onError: (error: Error) => {
      toast.error("Delete failed", { description: error.message });
    },
  });

  // Detach sample from profile mutation
  const detachSampleMutation = useMutation({
    mutationFn: async (
      { sampleId, profileId }: { sampleId: string; profileId: string },
    ) => {
      await callResource("mongo", {
        action: "updateOne",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { _id: { $oid: sampleId } },
        update: { $unset: { "metadata.profile_id": "" } },
      });
      const remainingSamples = await callResource("mongo", {
        action: "find",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { "metadata.profile_id": profileId },
        options: { projection: { _id: 1 } },
      });
      const remaining = Array.isArray(remainingSamples)
        ? remainingSamples.length
        : 0;
      if (remaining === 0) {
        await callResource("mongo", {
          action: "deleteOne",
          collection: "speaker_profiles",
          query: { _id: { $oid: profileId } },
        });
      } else {
        await invalidateAndRebuildProfile(profileId, remaining);
      }
    },
    onSuccess: () => {
      toast.success("Sample detached; profile embedding rebuild queued");
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to detach sample", { description: error.message });
    },
  });

  // Attach sample to profile mutation
  const attachSampleMutation = useMutation({
    mutationFn: async (
      { sampleId, profileId, profileName, isPrimary }: {
        sampleId: string;
        profileId: string;
        profileName: string;
        isPrimary: boolean;
      },
    ) => {
      const operations = buildAttachSampleOperations(sampleId, {
        id: profileId,
        name: profileName,
        isPrimary,
      });
      await callResource("mongo", operations.link);
      await queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      return await callResource("jobs", operations.enrollment);
    },
    onSuccess: () => {
      toast.success("Sample attached — updating voice embedding…", {
        description: "Completion or failure will appear as a job notification.",
      });
      setAttachingSample(null);
      setAttachToProfileId("");
    },
    onError: (error: Error) => {
      toast.error("Failed to attach sample", { description: error.message });
    },
  });

  // Recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      setSelectedSampleId(null);

      timerRef.current = globalThis.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch {
      toast.error("Microphone access denied", {
        description: "Please allow microphone access to record your voice.",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setRecordedBlob(file);
      setSelectedSampleId(null);
      setRecordingDuration(Math.round(file.size / 16000));
    }
  };

  const saveRecording = async () => {
    if (!recordedBlob) return;

    setIsSaving(true);
    try {
      toast.info("Converting audio format...");
      const wavBlob = await convertBlobToWav(recordedBlob);

      const arrayBuffer = await wavBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );

      await apiClient.post<{ file_id: string; success: boolean }>(
        "/api/files/upload",
        {
          file: base64,
          filename: `voice_sample_${Date.now()}.wav`,
          mimetype: "audio/wav",
          bucket: VOICE_SAMPLES_BUCKET,
          metadata: {
            speaker_name: newProfileName || "Unknown",
            duration: recordingDuration,
          },
        },
      );

      toast.success("Recording saved");
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
    } catch (error) {
      toast.error("Failed to save recording", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const selectSample = (sample: VoiceSample) => {
    setSelectedSampleId(getSampleId(sample));
    setRecordedBlob(null);
    setRecordingDuration(sample.metadata?.duration || 0);
    if (sample.metadata?.speaker_name && !newProfileName) {
      setNewProfileName(sample.metadata.speaker_name);
    }
  };

  const handleSubmit = async () => {
    if (!newProfileName.trim()) {
      toast.error("Please enter a name for the profile");
      return;
    }

    if (!recordedBlob && !selectedSampleId) {
      toast.error("Please record, upload audio, or select a saved sample");
      return;
    }

    // If using a saved sample, enroll directly
    if (selectedSampleId) {
      if (sampleTargetProfile) {
        const operations = buildAttachSampleOperations(selectedSampleId, {
          id: getProfileId(sampleTargetProfile),
          name: sampleTargetProfile.name,
          isPrimary: sampleTargetProfile.is_primary,
        });
        await callResource("mongo", operations.link);
        await queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      }
      enrollMutation.mutate({
        type: "enrollment",
        name: newProfileName.trim(),
        is_primary: isPrimary,
        sample_file_id: selectedSampleId,
        profile_id: sampleTargetProfile
          ? getProfileId(sampleTargetProfile)
          : undefined,
      });
      return;
    }

    // For new recordings/uploads, save to GridFS first, then enroll
    try {
      toast.info("Saving audio sample...");
      const wavBlob = await convertBlobToWav(recordedBlob!);

      const arrayBuffer = await wavBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );

      // Save to GridFS first
      const uploadResult = await apiClient.post<
        { file_id: string; success: boolean }
      >("/api/files/upload", {
        file: base64,
        filename: `voice_sample_${Date.now()}.wav`,
        mimetype: "audio/wav",
        bucket: VOICE_SAMPLES_BUCKET,
        metadata: {
          speaker_name: newProfileName.trim(),
          duration: recordingDuration,
          profile_id: sampleTargetProfile
            ? getProfileId(sampleTargetProfile)
            : undefined,
          source: recordedBlob instanceof File ? "file_upload" : "microphone",
          uploaded_at: new Date().toISOString(),
        },
      });

      if (!uploadResult.file_id) {
        throw new Error("Failed to save audio sample");
      }

      // Now enroll using the saved sample
      enrollMutation.mutate({
        type: "enrollment",
        name: newProfileName.trim(),
        is_primary: isPrimary,
        sample_file_id: uploadResult.file_id,
        profile_id: sampleTargetProfile
          ? getProfileId(sampleTargetProfile)
          : undefined,
      });
    } catch (error) {
      toast.error("Failed to save audio", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const resetForm = () => {
    setNewProfileName("");
    setIsPrimary(false);
    setRecordedBlob(null);
    setRecordingDuration(0);
    setSelectedSampleId(null);
    setSampleTargetProfile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openAddSampleDialog = (profile: SpeakerProfile) => {
    resetForm();
    setSampleTargetProfile(profile);
    setNewProfileName(profile.name);
    setIsPrimary(profile.is_primary);
    setIsDialogOpen(true);
  };

  const openEditDialog = (profile: SpeakerProfile) => {
    setEditingProfile(profile);
    setEditName(profile.name);
    setEditColor(profile.color);
    setEditIsPrimary(profile.is_primary);
  };

  const handleEditSubmit = () => {
    if (!editingProfile) return;
    updateProfileMutation.mutate({
      profileId: getProfileId(editingProfile),
      name: editName !== editingProfile.name ? editName : undefined,
      color: editColor !== editingProfile.color ? editColor : undefined,
      is_primary: editIsPrimary !== editingProfile.is_primary
        ? editIsPrimary
        : undefined,
    });
  };

  const setProfileExpanded = (profileId: string, open: boolean) => {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (open) next.add(profileId);
      else next.delete(profileId);
      return next;
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Voice Profiles</h2>
          <p className="text-muted-foreground">
            Enroll speaker voices for automatic identification in transcripts.
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => resetForm()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Profile
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {sampleTargetProfile
                  ? `Add sample to ${sampleTargetProfile.name}`
                  : "Enroll Voice Profile"}
              </DialogTitle>
              <DialogDescription>
                {sampleTargetProfile
                  ? "The sample is saved permanently and the profile embedding is rebuilt in the background."
                  : "Record 10-30 seconds of clear speech or upload an audio file."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Speaker Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Me, Wife, Bob"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  disabled={Boolean(sampleTargetProfile)}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="primary"
                  checked={isPrimary}
                  onCheckedChange={setIsPrimary}
                  disabled={Boolean(sampleTargetProfile)}
                />
                <Label htmlFor="primary">This is my voice</Label>
              </div>

              <div className="space-y-2">
                <Label>Audio Sample</Label>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    {!isRecording
                      ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={startRecording}
                          className="flex-1"
                        >
                          <Mic className="w-4 h-4 mr-2" />
                          Record from Mic
                        </Button>
                      )
                      : (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={stopRecording}
                          className="flex-1"
                        >
                          <Square className="w-4 h-4 mr-2" />
                          Stop Recording ({formatDuration(recordingDuration)})
                        </Button>
                      )}
                  </div>

                  <div className="text-center text-sm text-muted-foreground">
                    or
                  </div>

                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="audio-upload"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Audio File
                    </Button>
                  </div>

                  {recordedBlob && !isRecording && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                        <Play className="w-4 h-4" />
                        Audio ready ({formatDuration(recordingDuration)})
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={saveRecording}
                        disabled={isSaving}
                      >
                        {isSaving
                          ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          : <Save className="w-4 h-4 mr-1" />}
                        Save for later
                      </Button>
                    </div>
                  )}

                  {selectedSampleId && (
                    <div className="flex items-center justify-between gap-2 p-2 bg-muted rounded">
                      <div className="flex items-center gap-2 text-sm">
                        <FileAudio className="w-4 h-4 text-blue-500" />
                        <span>
                          Using saved sample ({formatDuration(
                            recordingDuration,
                          )})
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedSampleId(null);
                          setRecordingDuration(0);
                        }}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {unattachedSamples.length > 0 && !selectedSampleId && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">
                          Saved Voice Samples
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {unattachedSamples.length} saved
                        </span>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {unattachedSamples.map((sample) => (
                          <div
                            key={getSampleId(sample)}
                            className="flex items-center justify-between p-2 border rounded hover:bg-muted cursor-pointer transition-colors"
                            onClick={() => selectSample(sample)}
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <FileAudio className="w-4 h-4 text-blue-500" />
                              <span className="font-medium">
                                {sample.metadata?.speaker_name || "Unknown"}
                              </span>
                              <span className="text-muted-foreground">
                                ({formatDuration(
                                  sample.metadata?.duration || 0,
                                )})
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Click a sample to use it for enrollment
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={enrollMutation.isPending ||
                  (!recordedBlob && !selectedSampleId) ||
                  !newProfileName.trim()}
              >
                {enrollMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {sampleTargetProfile ? "Add and rebuild" : "Enroll Voice"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ServiceHealthBanner />

      {/* Profiles List */}
      {isLoading
        ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )
        : profiles?.length === 0
        ? (
          <Card>
            <CardContent className="py-12 text-center">
              <UserRound className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No voice profiles</h3>
              <p className="text-muted-foreground mb-4">
                Enroll your voice to start identifying speakers.
              </p>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Enroll My Voice
              </Button>
            </CardContent>
          </Card>
        )
        : (
          <div className="grid gap-4">
            {profiles?.map((profile) => {
              const profileId = getProfileId(profile);
              const profileSamples = getProfileSamples(profileId);
              const isExpanded = expandedProfiles.has(profileId);
              const sampleSummary = summarizeVoiceSamples(
                savedSamples === undefined ? undefined : profileSamples,
                {
                  count: profile.sample_count,
                  duration: profile.total_duration,
                },
              );

              return (
                <Card key={profileId}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
                          style={{ backgroundColor: profile.color }}
                          onClick={() => openEditDialog(profile)}
                        >
                          <UserRound className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-lg flex items-center gap-2">
                            {profile.name}
                            {profile.is_primary && (
                              <Badge variant="secondary">My Voice</Badge>
                            )}
                          </CardTitle>
                          <CardDescription>
                            {sampleSummary.count}{" "}
                            sample{sampleSummary.count !== 1 ? "s" : ""} •{" "}
                            {Math.round(sampleSummary.duration)}s saved
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAddSampleDialog(profile)}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Add sample
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(profile)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Delete Profile</DialogTitle>
                              <DialogDescription>
                                Delete "{profile.name}"? Existing segment
                                assignments will be cleared and its saved voice
                                samples will become unattached.
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <DialogClose asChild>
                                <Button variant="outline">Cancel</Button>
                              </DialogClose>
                              <DialogClose asChild>
                                <Button
                                  variant="destructive"
                                  onClick={() =>
                                    deleteMutation.mutate(profileId)}
                                >
                                  Delete
                                </Button>
                              </DialogClose>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </CardHeader>

                  {/* Expandable samples section */}
                  {profileSamples.length > 0 && (
                    <Collapsible
                      open={isExpanded}
                      onOpenChange={(open) =>
                        setProfileExpanded(profileId, open)}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start px-6 py-2 text-muted-foreground"
                        >
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 mr-2" />
                            : <ChevronRight className="w-4 h-4 mr-2" />}
                          {profileSamples.length}{" "}
                          voice sample{profileSamples.length !== 1 ? "s" : ""}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="pt-0 space-y-2">
                          {profileSamples.map((sample) => (
                            <div
                              key={getSampleId(sample)}
                              className="flex items-center gap-2 p-2 border rounded"
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                  <span className="max-w-64 truncate font-medium text-foreground">
                                    {sample.filename.split("/").at(-1) ??
                                      sample.filename}
                                  </span>
                                  <span>
                                    {formatDuration(
                                      sample.metadata?.duration || 0,
                                    )}
                                  </span>
                                  {sample.metadata?.source && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      {sample.metadata.source.replaceAll(
                                        "_",
                                        " ",
                                      )}
                                    </Badge>
                                  )}
                                  {sample.metadata?.source_start && (
                                    <span>
                                      {new Date(sample.metadata.source_start)
                                        .toLocaleString()}
                                    </span>
                                  )}
                                </div>
                                <WaveformPlayer
                                  audioUrl={`/api/files/${
                                    getSampleId(sample)
                                  }?bucket=${VOICE_SAMPLES_BUCKET}`}
                                  duration={sample.metadata?.duration}
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-blue-500 shrink-0"
                                title="Detach from profile"
                                onClick={() =>
                                  detachSampleMutation.mutate(
                                    {
                                      sampleId: getSampleId(sample),
                                      profileId,
                                    },
                                  )}
                                disabled={detachSampleMutation.isPending}
                              >
                                <Unlink className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                title="Delete sample"
                                onClick={() =>
                                  setDeletingSample({
                                    sampleId: getSampleId(sample),
                                    profileId,
                                  })}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </Card>
              );
            })}
          </div>
        )}

      {/* Unattached Samples Section */}
      {unattachedSamples.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Unattached Voice Samples</CardTitle>
            <CardDescription>
              These samples are not linked to any profile. Attach them to an
              existing profile or use them to create a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {unattachedSamples.map((sample) => (
              <div
                key={getSampleId(sample)}
                className="flex items-center gap-3 p-3 border rounded"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium mb-1">
                    {sample.metadata?.speaker_name || "Unknown"}
                  </div>
                  <WaveformPlayer
                    audioUrl={`/api/files/${
                      getSampleId(sample)
                    }?bucket=${VOICE_SAMPLES_BUCKET}`}
                    duration={sample.metadata?.duration}
                  />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {profiles && profiles.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAttachingSample(sample)}
                    >
                      Attach
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      deleteSampleMutation.mutate(getSampleId(sample))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Edit Profile Dialog */}
      <Dialog
        open={!!editingProfile}
        onOpenChange={(open) => !open && setEditingProfile(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update the profile name, color, or settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PROFILE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      editColor === color
                        ? "border-foreground scale-110"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditColor(color)}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-primary"
                checked={editIsPrimary}
                onCheckedChange={setEditIsPrimary}
              />
              <Label htmlFor="edit-primary">This is my voice</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProfile(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateProfileMutation.isPending}
            >
              {updateProfileMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Attached Sample Warning Dialog */}
      <Dialog
        open={!!deletingSample}
        onOpenChange={(open) => !open && setDeletingSample(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Delete Voice Sample
            </DialogTitle>
            <DialogDescription>
              This sample is attached to a voice profile. Deleting it will
              update the profile's sample count. If this is the only sample, the
              profile will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingSample(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingSample &&
                deleteAttachedSampleMutation.mutate(deletingSample)}
              disabled={deleteAttachedSampleMutation.isPending}
            >
              {deleteAttachedSampleMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Delete Sample
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach Sample Dialog */}
      <Dialog
        open={!!attachingSample}
        onOpenChange={(open) => !open && setAttachingSample(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach Sample to Profile</DialogTitle>
            <DialogDescription>
              Select a profile to attach this voice sample to. The profile's
              voice embedding will be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select
              value={attachToProfileId}
              onValueChange={setAttachToProfileId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles?.map((profile) => (
                  <SelectItem
                    key={getProfileId(profile)}
                    value={getProfileId(profile)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: profile.color }}
                      />
                      {profile.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachingSample(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (attachingSample && attachToProfileId) {
                  const profile = profiles?.find((p) =>
                    getProfileId(p) === attachToProfileId
                  );
                  if (profile) {
                    attachSampleMutation.mutate({
                      sampleId: getSampleId(attachingSample),
                      profileId: getProfileId(profile),
                      profileName: profile.name,
                      isPrimary: profile.is_primary,
                    });
                  }
                }
              }}
              disabled={!attachToProfileId || attachSampleMutation.isPending}
            >
              {attachSampleMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Help text */}
      <Card className="bg-muted/50">
        <CardContent className="py-4">
          <h4 className="font-medium mb-2">
            Tips for better voice identification
          </h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>* Record 10-30 seconds of clear, natural speech</li>
            <li>* Avoid background noise and overlapping speakers</li>
            <li>* Add multiple samples to improve accuracy</li>
            <li>
              * Use the "Run Matching" job to identify speakers in past
              recordings
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default VoiceProfilesPage;
