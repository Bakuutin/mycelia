import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { callResource, apiClient } from "@/lib/api";
import { convertBlobToWav } from "@/lib/audioUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Mic, Upload, Trash2, Plus, Play, Square, UserRound, Loader2, Save, FileAudio, RotateCcw, Pencil, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { WaveformPlayer } from "@/components/audio/WaveformPlayer";

const VOICE_SAMPLES_BUCKET = "voice_samples";

// Pre-defined colors for speaker profiles
const PROFILE_COLORS = [
  "#3b82f6",  // Blue
  "#ef4444",  // Red
  "#10b981",  // Green
  "#f59e0b",  // Amber
  "#8b5cf6",  // Purple
  "#ec4899",  // Pink
  "#06b6d4",  // Cyan
  "#f97316",  // Orange
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
  if (profile._id && typeof profile._id === "object" && "$oid" in (profile._id as object)) {
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
  };
  length: number;
}

interface EnrollmentJobData {
  type: "enrollment";
  name: string;
  is_primary: boolean;
  audio_data_base64?: string;
  sample_file_id?: string;
}

const VoiceProfilesPage = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());
  
  // Edit profile state
  const [editingProfile, setEditingProfile] = useState<SpeakerProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIsPrimary, setEditIsPrimary] = useState(false);
  
  // Delete sample warning state
  const [deletingSample, setDeletingSample] = useState<{ sampleId: string; profileId: string } | null>(null);
  
  // Attach sample state
  const [attachingSample, setAttachingSample] = useState<VoiceSample | null>(null);
  const [attachToProfileId, setAttachToProfileId] = useState<string>("");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch speaker profiles
  const { data: profiles, isLoading } = useQuery({
    queryKey: ["speaker_profiles"],
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
    return savedSamples?.filter(s => s.metadata?.profile_id === profileId) || [];
  };

  // Get unattached samples
  const unattachedSamples = savedSamples?.filter(s => !s.metadata?.profile_id) || [];

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
        description: "Your voice profile is being created. This may take a few seconds.",
      });
      setIsDialogOpen(false);
      resetForm();
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
        queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      }, 3000);
    },
    onError: (error: Error) => {
      toast.error("Enrollment failed", { description: error.message });
    },
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async ({ profileId, name, color, is_primary }: { profileId: string; name?: string; color?: string; is_primary?: boolean }) => {
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
      queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
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

  // Delete attached sample mutation (with profile update)
  const deleteAttachedSampleMutation = useMutation({
    mutationFn: async ({ sampleId, profileId }: { sampleId: string; profileId: string }) => {
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
        // Update sample count
        await callResource("mongo", {
          action: "updateOne",
          collection: "speaker_profiles",
          query: { _id: { $oid: profileId } },
          update: { $set: { sample_count: remaining.length, updated_at: new Date().toISOString() } },
        });
      }
    },
    onSuccess: () => {
      toast.success("Sample deleted");
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
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
        action: "deleteOne",
        collection: "speaker_profiles",
        query: { _id: { $oid: profileId } },
      });
    },
    onSuccess: () => {
      toast.success("Profile deleted");
      queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
    },
    onError: (error: Error) => {
      toast.error("Delete failed", { description: error.message });
    },
  });

  // Attach sample to profile mutation
  const attachSampleMutation = useMutation({
    mutationFn: async ({ sampleId, profileName, isPrimary }: { sampleId: string; profileName: string; isPrimary: boolean }) => {
      return await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "enrollment",
          name: profileName,
          is_primary: isPrimary,
          sample_file_id: sampleId,
        },
      });
    },
    onSuccess: () => {
      toast.success("Attaching sample to profile...", {
        description: "The voice embedding will be updated.",
      });
      setAttachingSample(null);
      setAttachToProfileId("");
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
        queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
      }, 3000);
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

      timerRef.current = window.setInterval(() => {
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
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      await apiClient.post<{ file_id: string; success: boolean }>("/api/files/upload", {
        file: base64,
        filename: `voice_sample_${Date.now()}.wav`,
        mimetype: "audio/wav",
        bucket: VOICE_SAMPLES_BUCKET,
        metadata: {
          speaker_name: newProfileName || "Unknown",
          duration: recordingDuration,
        },
      });

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
      enrollMutation.mutate({
        type: "enrollment",
        name: newProfileName.trim(),
        is_primary: isPrimary,
        sample_file_id: selectedSampleId,
      });
      return;
    }

    // For new recordings/uploads, save to GridFS first, then enroll
    try {
      toast.info("Saving audio sample...");
      const wavBlob = await convertBlobToWav(recordedBlob!);
      
      const arrayBuffer = await wavBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Save to GridFS first
      const uploadResult = await apiClient.post<{ file_id: string; success: boolean }>("/api/files/upload", {
        file: base64,
        filename: `voice_sample_${Date.now()}.wav`,
        mimetype: "audio/wav",
        bucket: VOICE_SAMPLES_BUCKET,
        metadata: {
          speaker_name: newProfileName.trim(),
          duration: recordingDuration,
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
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      is_primary: editIsPrimary !== editingProfile.is_primary ? editIsPrimary : undefined,
    });
  };

  const toggleProfileExpanded = (profileId: string) => {
    setExpandedProfiles(prev => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
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
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Profile
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Enroll Voice Profile</DialogTitle>
              <DialogDescription>
                Record 10-30 seconds of clear speech or upload an audio file.
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
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch id="primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
                <Label htmlFor="primary">This is my voice</Label>
              </div>

              <div className="space-y-2">
                <Label>Audio Sample</Label>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    {!isRecording ? (
                      <Button type="button" variant="outline" onClick={startRecording} className="flex-1">
                        <Mic className="w-4 h-4 mr-2" />
                        Record from Mic
                      </Button>
                    ) : (
                      <Button type="button" variant="destructive" onClick={stopRecording} className="flex-1">
                        <Square className="w-4 h-4 mr-2" />
                        Stop Recording ({formatDuration(recordingDuration)})
                      </Button>
                    )}
                  </div>

                  <div className="text-center text-sm text-muted-foreground">or</div>

                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="audio-upload"
                    />
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full">
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
                      <Button type="button" variant="ghost" size="sm" onClick={saveRecording} disabled={isSaving}>
                        {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                        Save for later
                      </Button>
                    </div>
                  )}

                  {selectedSampleId && (
                    <div className="flex items-center justify-between gap-2 p-2 bg-muted rounded">
                      <div className="flex items-center gap-2 text-sm">
                        <FileAudio className="w-4 h-4 text-blue-500" />
                        <span>Using saved sample ({formatDuration(recordingDuration)})</span>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedSampleId(null); setRecordingDuration(0); }}>
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  {unattachedSamples.length > 0 && !selectedSampleId && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Saved Voice Samples</Label>
                        <span className="text-xs text-muted-foreground">{unattachedSamples.length} saved</span>
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
                              <span className="font-medium">{sample.metadata?.speaker_name || "Unknown"}</span>
                              <span className="text-muted-foreground">({formatDuration(sample.metadata?.duration || 0)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Click a sample to use it for enrollment</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={enrollMutation.isPending || (!recordedBlob && !selectedSampleId) || !newProfileName.trim()}>
                {enrollMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enroll Voice
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Profiles List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : profiles?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserRound className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No voice profiles</h3>
            <p className="text-muted-foreground mb-4">Enroll your voice to start identifying speakers.</p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Enroll My Voice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles?.map((profile) => {
            const profileId = getProfileId(profile);
            const profileSamples = getProfileSamples(profileId);
            const isExpanded = expandedProfiles.has(profileId);

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
                          {profile.is_primary && <Badge variant="secondary">My Voice</Badge>}
                        </CardTitle>
                        <CardDescription>
                          {profile.sample_count} sample{profile.sample_count !== 1 ? "s" : ""} • {Math.round(profile.total_duration)}s total
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(profile)}>
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
                              Are you sure you want to delete "{profile.name}"? This will not remove speaker labels from existing transcripts.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <DialogClose asChild>
                              <Button variant="destructive" onClick={() => deleteMutation.mutate(profileId)}>Delete</Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>

                {/* Expandable samples section */}
                {profileSamples.length > 0 && (
                  <Collapsible open={isExpanded} onOpenChange={() => toggleProfileExpanded(profileId)}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-start px-6 py-2 text-muted-foreground">
                        {isExpanded ? <ChevronDown className="w-4 h-4 mr-2" /> : <ChevronRight className="w-4 h-4 mr-2" />}
                        {profileSamples.length} voice sample{profileSamples.length !== 1 ? "s" : ""}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0 space-y-2">
                        {profileSamples.map((sample) => (
                          <div key={getSampleId(sample)} className="flex items-center gap-2 p-2 border rounded">
                            <div className="flex-1">
                              <WaveformPlayer
                                audioUrl={`/api/files/${getSampleId(sample)}?bucket=${VOICE_SAMPLES_BUCKET}`}
                                duration={sample.metadata?.duration}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setDeletingSample({ sampleId: getSampleId(sample), profileId })}
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
              These samples are not linked to any profile. Attach them to an existing profile or use them to create a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {unattachedSamples.map((sample) => (
              <div key={getSampleId(sample)} className="flex items-center gap-3 p-3 border rounded">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium mb-1">{sample.metadata?.speaker_name || "Unknown"}</div>
                  <WaveformPlayer
                    audioUrl={`/api/files/${getSampleId(sample)}?bucket=${VOICE_SAMPLES_BUCKET}`}
                    duration={sample.metadata?.duration}
                  />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {profiles && profiles.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setAttachingSample(sample)}>
                      Attach
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => deleteSampleMutation.mutate(getSampleId(sample))}
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
      <Dialog open={!!editingProfile} onOpenChange={(open) => !open && setEditingProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update the profile name, color, or settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PROFILE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-all ${editColor === color ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditColor(color)}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="edit-primary" checked={editIsPrimary} onCheckedChange={setEditIsPrimary} />
              <Label htmlFor="edit-primary">This is my voice</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProfile(null)}>Cancel</Button>
            <Button onClick={handleEditSubmit} disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Attached Sample Warning Dialog */}
      <Dialog open={!!deletingSample} onOpenChange={(open) => !open && setDeletingSample(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Delete Voice Sample
            </DialogTitle>
            <DialogDescription>
              This sample is attached to a voice profile. Deleting it will update the profile's sample count.
              If this is the only sample, the profile will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingSample(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deletingSample && deleteAttachedSampleMutation.mutate(deletingSample)}
              disabled={deleteAttachedSampleMutation.isPending}
            >
              {deleteAttachedSampleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete Sample
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attach Sample Dialog */}
      <Dialog open={!!attachingSample} onOpenChange={(open) => !open && setAttachingSample(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach Sample to Profile</DialogTitle>
            <DialogDescription>
              Select a profile to attach this voice sample to. The profile's voice embedding will be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={attachToProfileId} onValueChange={setAttachToProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles?.map((profile) => (
                  <SelectItem key={getProfileId(profile)} value={getProfileId(profile)}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: profile.color }} />
                      {profile.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachingSample(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (attachingSample && attachToProfileId) {
                  const profile = profiles?.find(p => getProfileId(p) === attachToProfileId);
                  if (profile) {
                    attachSampleMutation.mutate({
                      sampleId: getSampleId(attachingSample),
                      profileName: profile.name,
                      isPrimary: profile.is_primary,
                    });
                  }
                }
              }}
              disabled={!attachToProfileId || attachSampleMutation.isPending}
            >
              {attachSampleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Help text */}
      <Card className="bg-muted/50">
        <CardContent className="py-4">
          <h4 className="font-medium mb-2">Tips for better voice identification</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>* Record 10-30 seconds of clear, natural speech</li>
            <li>* Avoid background noise and overlapping speakers</li>
            <li>* Add multiple samples to improve accuracy</li>
            <li>* Use the "Run Matching" job to identify speakers in past recordings</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default VoiceProfilesPage;
