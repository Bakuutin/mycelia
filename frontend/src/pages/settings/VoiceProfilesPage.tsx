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
import { Mic, Upload, Trash2, Plus, Play, Square, UserRound, Loader2, Save, FileAudio, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const VOICE_SAMPLES_BUCKET = "voice_samples";

// Helper to extract ID string from EJSON ObjectId or plain string
const getSampleId = (sample: VoiceSample): string => {
  if (typeof sample._id === "string") return sample._id;
  if (sample._id && typeof sample._id === "object" && "$oid" in sample._id) {
    return sample._id.$oid;
  }
  return String(sample._id);
};

interface SpeakerProfile {
  _id: string;
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
      return (result?.data || []) as SpeakerProfile[];
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
      // Refetch profiles after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["speaker_profiles"] });
      }, 3000);
    },
    onError: (error: Error) => {
      toast.error("Enrollment failed", {
        description: error.message,
      });
    },
  });

  // Delete sample mutation
  const deleteSampleMutation = useMutation({
    mutationFn: async (sampleId: string) => {
      // Delete from GridFS files collection directly
      await callResource("mongo", {
        action: "deleteOne",
        collection: `${VOICE_SAMPLES_BUCKET}.files`,
        query: { _id: { $oid: sampleId } },
      });
      // Also delete chunks
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

  // Delete mutation
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

  // Start recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      setSelectedSampleId(null); // Clear selected sample when recording

      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      toast.error("Microphone access denied", {
        description: "Please allow microphone access to record your voice.",
      });
    }
  };

  // Stop recording
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

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setRecordedBlob(file);
      setSelectedSampleId(null); // Clear selected sample
      // Estimate duration from file size (rough approximation)
      setRecordingDuration(Math.round(file.size / 16000)); // ~16KB per second for compressed audio
    }
  };

  // Save current recording to GridFS for later use
  const saveRecording = async () => {
    if (!recordedBlob) return;

    setIsSaving(true);
    try {
      // Convert to WAV format (16kHz mono) for compatibility with diarization service
      toast.info("Converting audio format...");
      const wavBlob = await convertBlobToWav(recordedBlob);
      
      // Convert WAV blob to base64
      const arrayBuffer = await wavBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Upload to GridFS via the file upload API
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

      toast.success("Recording saved", {
        description: "You can use this sample for enrollment later.",
      });
      queryClient.invalidateQueries({ queryKey: ["voice_samples"] });
    } catch (error) {
      toast.error("Failed to save recording", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Select a saved sample for enrollment
  const selectSample = (sample: VoiceSample) => {
    setSelectedSampleId(getSampleId(sample));
    setRecordedBlob(null); // Clear recorded blob
    setRecordingDuration(sample.metadata?.duration || 0);
    if (sample.metadata?.speaker_name && !newProfileName) {
      setNewProfileName(sample.metadata.speaker_name);
    }
  };

  // Submit enrollment
  const handleSubmit = async () => {
    if (!newProfileName.trim()) {
      toast.error("Please enter a name for the profile");
      return;
    }

    if (!recordedBlob && !selectedSampleId) {
      toast.error("Please record, upload audio, or select a saved sample");
      return;
    }

    // If using saved sample, use sample_file_id (already in WAV format)
    if (selectedSampleId) {
      enrollMutation.mutate({
        type: "enrollment",
        name: newProfileName.trim(),
        is_primary: isPrimary,
        sample_file_id: selectedSampleId,
      });
      return;
    }

    // Convert recorded blob to WAV (16kHz mono) and then to base64
    try {
      toast.info("Converting audio format...");
      const wavBlob = await convertBlobToWav(recordedBlob!);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        enrollMutation.mutate({
          type: "enrollment",
          name: newProfileName.trim(),
          is_primary: isPrimary,
          audio_data_base64: base64,
        });
      };
      reader.readAsDataURL(wavBlob);
    } catch (error) {
      toast.error("Failed to convert audio", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  // Reset form
  const resetForm = () => {
    setNewProfileName("");
    setIsPrimary(false);
    setRecordedBlob(null);
    setRecordingDuration(0);
    setSelectedSampleId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
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
                <Switch
                  id="primary"
                  checked={isPrimary}
                  onCheckedChange={setIsPrimary}
                />
                <Label htmlFor="primary">This is my voice</Label>
              </div>

              <div className="space-y-2">
                <Label>Audio Sample</Label>
                <div className="flex flex-col gap-3">
                  {/* Recording controls */}
                  <div className="flex items-center gap-2">
                    {!isRecording ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={startRecording}
                        className="flex-1"
                      >
                        <Mic className="w-4 h-4 mr-2" />
                        Record from Mic
                      </Button>
                    ) : (
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

                  <div className="text-center text-sm text-muted-foreground">or</div>

                  {/* File upload */}
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

                  {/* Status and Save button */}
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
                        {isSaving ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Save for later
                      </Button>
                    </div>
                  )}

                  {/* Selected saved sample */}
                  {selectedSampleId && (
                    <div className="flex items-center justify-between gap-2 p-2 bg-muted rounded">
                      <div className="flex items-center gap-2 text-sm">
                        <FileAudio className="w-4 h-4 text-blue-500" />
                        <span>Using saved sample ({formatDuration(recordingDuration)})</span>
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

                  {/* Saved samples list */}
                  {savedSamples && savedSamples.length > 0 && !selectedSampleId && !recordedBlob && (
                    <div className="space-y-2">
                      <div className="text-center text-sm text-muted-foreground">or use saved sample</div>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {savedSamples.map((sample) => (
                          <div
                            key={getSampleId(sample)}
                            className="flex items-center justify-between p-2 border rounded hover:bg-muted cursor-pointer"
                            onClick={() => selectSample(sample)}
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <FileAudio className="w-4 h-4" />
                              <span>{sample.metadata?.speaker_name || "Unknown"}</span>
                              <span className="text-muted-foreground">
                                ({formatDuration(sample.metadata?.duration || 0)})
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSampleMutation.mutate(getSampleId(sample));
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
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
                disabled={enrollMutation.isPending || (!recordedBlob && !selectedSampleId) || !newProfileName.trim()}
              >
                {enrollMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Enroll Voice
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : profiles?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserRound className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No voice profiles</h3>
            <p className="text-muted-foreground mb-4">
              Enroll your voice to start identifying speakers in your recordings.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Enroll My Voice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {profiles?.map((profile) => (
            <Card key={profile._id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: profile.color }}
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
                        {profile.sample_count} sample{profile.sample_count !== 1 ? "s" : ""} • {Math.round(profile.total_duration)}s total
                      </CardDescription>
                    </div>
                  </div>
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
                          <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(profile._id)}
                          >
                            Delete
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Help text */}
      <Card className="bg-muted/50">
        <CardContent className="py-4">
          <h4 className="font-medium mb-2">Tips for better voice identification</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Record 10-30 seconds of clear, natural speech</li>
            <li>• Avoid background noise and overlapping speakers</li>
            <li>• Add multiple samples to improve accuracy</li>
            <li>• Use the "Run Matching" job to identify speakers in past recordings</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default VoiceProfilesPage;
