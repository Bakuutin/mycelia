import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Mic, Upload, Trash2, Plus, Play, Square, UserRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

interface EnrollmentJobData {
  type: "enrollment";
  name: string;
  is_primary: boolean;
  audio_data_base64: string;
}

const VoiceProfilesPage = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch speaker profiles
  const { data: profiles, isLoading } = useQuery({
    queryKey: ["speaker_profiles"],
    queryFn: async () => {
      const response = await api.get<{ data: SpeakerProfile[] }>("/resource/speaker_profiles", {
        params: { action: "find", query: JSON.stringify({}), options: JSON.stringify({ sort: { created_at: 1 } }) }
      });
      return response.data.data || [];
    },
  });

  // Enrollment mutation
  const enrollMutation = useMutation({
    mutationFn: async (data: EnrollmentJobData) => {
      const response = await api.post("/resource/jobs", {
        action: "enqueue",
        data: data,
      });
      return response.data;
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (profileId: string) => {
      await api.post("/resource/speaker_profiles", {
        action: "deleteOne",
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
      // Estimate duration from file size (rough approximation)
      setRecordingDuration(Math.round(file.size / 16000)); // ~16KB per second for compressed audio
    }
  };

  // Submit enrollment
  const handleSubmit = async () => {
    if (!newProfileName.trim()) {
      toast.error("Please enter a name for the profile");
      return;
    }

    if (!recordedBlob) {
      toast.error("Please record or upload audio");
      return;
    }

    // Convert blob to base64
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
    reader.readAsDataURL(recordedBlob);
  };

  // Reset form
  const resetForm = () => {
    setNewProfileName("");
    setIsPrimary(false);
    setRecordedBlob(null);
    setRecordingDuration(0);
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

                  {/* Status */}
                  {recordedBlob && !isRecording && (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <Play className="w-4 h-4" />
                      Audio ready ({formatDuration(recordingDuration)})
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
                disabled={enrollMutation.isPending || !recordedBlob || !newProfileName.trim()}
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Profile</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{profile.name}"? This will not remove speaker labels from existing transcripts.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(profile._id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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
