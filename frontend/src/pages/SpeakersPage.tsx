import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { callResource, apiClient } from "@/lib/api";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime } from "@/lib/formatTime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { embeddingToColor } from "@/lib/pcaColor";
import {
  User,
  Upload,
  Trash2,
  Plus,
  RefreshCw,
  Clock,
  Mic,
  FileAudio,
  Check,
  X,
  Loader2,
  Play,
  ChevronRight,
} from "lucide-react";

// Types
interface Speaker {
  id: string;
  name: string;
  user_id: number;
  created_at?: string;
  updated_at?: string;
  audio_sample_count?: number;
  total_audio_duration?: number;
  embedding_data?: number[];
}

interface DiarizationSegment {
  _id: unknown;
  start: Date;
  end: Date;
  original_id?: unknown;
  embedding?: number[];
  speaker?: string;
  duration?: number;
}

interface EnrollmentFile {
  file: File;
  name: string;
  duration?: number;
}

// Configuration - diarization service URL
const DIARIZATION_SERVICE_URL = "/api/diarization";

// Helper to format duration
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toFixed(0)}s`;
}

const SpeakersPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { timeFormat } = useSettingsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Enroll dialog state
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [enrollName, setEnrollName] = useState("");
  const [enrollFiles, setEnrollFiles] = useState<EnrollmentFile[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // Speaker detail sheet state
  const [selectedSpeaker, setSelectedSpeaker] = useState<Speaker | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  // Timeline selection state for enrollment
  const [timelineSelectionMode, setTimelineSelectionMode] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState<DiarizationSegment[]>([]);
  const [segmentRangeStart, setSegmentRangeStart] = useState<Date | undefined>();
  const [segmentRangeEnd, setSegmentRangeEnd] = useState<Date | undefined>();
  const [diarizationSegments, setDiarizationSegments] = useState<DiarizationSegment[]>([]);
  const [loadingSegments, setLoadingSegments] = useState(false);

  // Delete confirmation
  const [deleteConfirmSpeaker, setDeleteConfirmSpeaker] = useState<Speaker | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Default user ID (could be from auth context in real app)
  const userId = 1;

  // Load speakers from diarization service
  const loadSpeakers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{ speakers: Speaker[] }>(
        `${DIARIZATION_SERVICE_URL}/speakers`
      );
      // Filter speakers for current user
      const userSpeakers = (response.speakers || []).filter(
        (s) => s.id.startsWith(`user_${userId}_`)
      );
      setSpeakers(userSpeakers);
    } catch (err) {
      console.error("Failed to load speakers:", err);
      setError(err instanceof Error ? err.message : "Failed to load speakers");
      setSpeakers([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadSpeakers();
  }, [loadSpeakers]);

  // Handle file selection for enrollment
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: EnrollmentFile[] = Array.from(files).map((file) => ({
      file,
      name: file.name,
    }));
    setEnrollFiles((prev) => [...prev, ...newFiles]);
  };

  const removeEnrollFile = (index: number) => {
    setEnrollFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Enroll a new speaker
  const handleEnroll = async () => {
    if (!enrollName.trim()) {
      setEnrollError("Please enter a speaker name");
      return;
    }

    if (enrollFiles.length === 0 && selectedSegments.length === 0) {
      setEnrollError("Please add at least one audio file or select timeline segments");
      return;
    }

    setEnrolling(true);
    setEnrollError(null);

    try {
      const speakerId = `user_${userId}_${enrollName.toLowerCase().replace(/\s+/g, "_")}`;
      const formData = new FormData();
      formData.append("speaker_id", speakerId);
      formData.append("speaker_name", enrollName);

      // Add files
      enrollFiles.forEach((ef) => {
        formData.append("files", ef.file);
      });

      // If we have timeline segments, we need to fetch their audio and add to enrollment
      if (selectedSegments.length > 0) {
        for (const segment of selectedSegments) {
          const originalId = segment.original_id;
          const startSec = segment.start.getTime() / 1000;
          const endSec = segment.end.getTime() / 1000;

          // Fetch audio for this segment
          const blob = await apiClient.getBlob(
            `/api/audio/wav?start=${startSec}&end=${endSec}&original_id=${originalId}`
          );
          const segmentFile = new File(
            [blob],
            `segment_${segment.start.getTime()}.wav`,
            { type: "audio/wav" }
          );
          formData.append("files", segmentFile);
        }
      }

      // Call enrollment API
      const response = await fetch(`${apiClient.baseURL}${DIARIZATION_SERVICE_URL}/enroll/batch`, {
        method: "POST",
        headers: await apiClient.getAuthHeaders(),
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Enrollment failed: ${response.statusText}`);
      }

      // Success - reload speakers and close dialog
      await loadSpeakers();
      setEnrollDialogOpen(false);
      setEnrollName("");
      setEnrollFiles([]);
      setSelectedSegments([]);
    } catch (err) {
      console.error("Enrollment failed:", err);
      setEnrollError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  };

  // Delete a speaker
  const handleDelete = async (speaker: Speaker) => {
    setDeleting(true);
    try {
      await fetch(`${apiClient.baseURL}${DIARIZATION_SERVICE_URL}/speakers/${speaker.id}`, {
        method: "DELETE",
        headers: await apiClient.getAuthHeaders(),
      });
      await loadSpeakers();
      setDeleteConfirmSpeaker(null);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(false);
    }
  };

  // Load diarization segments for timeline selection
  const loadDiarizationSegments = async () => {
    if (!segmentRangeStart || !segmentRangeEnd) return;

    setLoadingSegments(true);
    try {
      const docs: DiarizationSegment[] = await callResource("mongo", {
        action: "find",
        collection: "diarizations",
        query: {
          start: { $lt: segmentRangeEnd },
          end: { $gt: segmentRangeStart },
        },
        options: { sort: { start: 1 }, limit: 500 },
      });
      setDiarizationSegments(docs);
    } catch (err) {
      console.error("Failed to load segments:", err);
    } finally {
      setLoadingSegments(false);
    }
  };

  const toggleSegmentSelection = (segment: DiarizationSegment) => {
    setSelectedSegments((prev) => {
      const exists = prev.some(
        (s) => s.start.getTime() === segment.start.getTime() && s.end.getTime() === segment.end.getTime()
      );
      if (exists) {
        return prev.filter(
          (s) => !(s.start.getTime() === segment.start.getTime() && s.end.getTime() === segment.end.getTime())
        );
      }
      return [...prev, segment];
    });
  };

  // Render
  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Speakers</h1>
        <div className="border rounded-lg p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground">Loading speakers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Speakers</h1>
          <p className="text-muted-foreground">
            Manage enrolled speaker profiles for voice identification
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadSpeakers} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={enrollDialogOpen} onOpenChange={setEnrollDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Enroll Speaker
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Enroll New Speaker</DialogTitle>
                <DialogDescription>
                  Add audio samples to create a voice profile for speaker identification
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="upload" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="upload">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Files
                  </TabsTrigger>
                  <TabsTrigger value="timeline">
                    <Clock className="h-4 w-4 mr-2" />
                    From Timeline
                  </TabsTrigger>
                </TabsList>

                {/* Upload Files Tab */}
                <TabsContent value="upload" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="speaker-name">Speaker Name</Label>
                    <Input
                      id="speaker-name"
                      placeholder="e.g., John Doe"
                      value={enrollName}
                      onChange={(e) => setEnrollName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Audio Samples</Label>
                    <div className="border-2 border-dashed rounded-lg p-6 text-center">
                      <FileAudio className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground mb-2">
                        Upload WAV or FLAC files (10-30 seconds each recommended)
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".wav,.flac,.mp3,.ogg"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Select Files
                      </Button>
                    </div>
                  </div>

                  {/* Selected files list */}
                  {enrollFiles.length > 0 && (
                    <div className="space-y-2">
                      <Label>Selected Files ({enrollFiles.length})</Label>
                      <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                        {enrollFiles.map((ef, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2"
                          >
                            <div className="flex items-center gap-2">
                              <FileAudio className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm truncate max-w-[300px]">
                                {ef.name}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeEnrollFile(idx)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Timeline Selection Tab */}
                <TabsContent value="timeline" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="speaker-name-timeline">Speaker Name</Label>
                    <Input
                      id="speaker-name-timeline"
                      placeholder="e.g., John Doe"
                      value={enrollName}
                      onChange={(e) => setEnrollName(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <DateTimePicker
                        value={segmentRangeStart}
                        onChange={(date) => date && setSegmentRangeStart(date)}
                        placeholder="Select start"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <DateTimePicker
                        value={segmentRangeEnd}
                        onChange={(date) => date && setSegmentRangeEnd(date)}
                        placeholder="Select end"
                      />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={loadDiarizationSegments}
                    disabled={!segmentRangeStart || !segmentRangeEnd || loadingSegments}
                  >
                    {loadingSegments ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Load Segments
                  </Button>

                  {/* Diarization segments list */}
                  {diarizationSegments.length > 0 && (
                    <div className="space-y-2">
                      <Label>
                        Available Segments ({diarizationSegments.length}) - Click to select
                      </Label>
                      <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                        {diarizationSegments.map((segment, idx) => {
                          const isSelected = selectedSegments.some(
                            (s) =>
                              s.start.getTime() === segment.start.getTime() &&
                              s.end.getTime() === segment.end.getTime()
                          );
                          const color = embeddingToColor(segment.embedding) || "#888";
                          const duration =
                            (segment.end.getTime() - segment.start.getTime()) / 1000;

                          return (
                            <div
                              key={idx}
                              className={`flex items-center justify-between p-2 cursor-pointer hover:bg-muted/50 ${
                                isSelected ? "bg-primary/10" : ""
                              }`}
                              onClick={() => toggleSegmentSelection(segment)}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: color }}
                                />
                                <div>
                                  <div className="text-sm">
                                    {formatTime(segment.start, timeFormat)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatDuration(duration)}
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <Check className="h-4 w-4 text-primary" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Selected segments summary */}
                  {selectedSegments.length > 0 && (
                    <div className="p-3 bg-primary/10 rounded-lg">
                      <p className="text-sm font-medium">
                        {selectedSegments.length} segment(s) selected
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Total duration:{" "}
                        {formatDuration(
                          selectedSegments.reduce(
                            (acc, s) => acc + (s.end.getTime() - s.start.getTime()) / 1000,
                            0
                          )
                        )}
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              {enrollError && (
                <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                  {enrollError}
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEnrollDialogOpen(false);
                    setEnrollName("");
                    setEnrollFiles([]);
                    setSelectedSegments([]);
                    setEnrollError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEnroll}
                  disabled={
                    enrolling ||
                    !enrollName.trim() ||
                    (enrollFiles.length === 0 && selectedSegments.length === 0)
                  }
                >
                  {enrolling ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Enroll Speaker
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
          {error}
        </div>
      )}

      {/* Speakers grid */}
      {speakers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <User className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Speakers Enrolled</h3>
            <p className="text-muted-foreground mb-4">
              Enroll speakers to enable voice identification in your recordings
            </p>
            <Button onClick={() => setEnrollDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Enroll Your First Speaker
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {speakers.map((speaker) => {
            const color = embeddingToColor(speaker.embedding_data) || "#6366f1";
            return (
              <Card
                key={speaker.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => {
                  setSelectedSpeaker(speaker);
                  setDetailSheetOpen(true);
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: color + "20" }}
                    >
                      <User className="h-5 w-5" style={{ color }} />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{speaker.name}</CardTitle>
                      <CardDescription className="text-xs font-mono">
                        {speaker.id}
                      </CardDescription>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Samples: </span>
                      <span className="font-medium">
                        {speaker.audio_sample_count || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Duration: </span>
                      <span className="font-medium">
                        {speaker.total_audio_duration
                          ? formatDuration(speaker.total_audio_duration)
                          : "N/A"}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Speaker detail sheet */}
      <Sheet open={detailSheetOpen} onOpenChange={setDetailSheetOpen}>
        <SheetContent className="sm:max-w-lg">
          {selectedSpeaker && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor:
                        (embeddingToColor(selectedSpeaker.embedding_data) || "#6366f1") +
                        "20",
                    }}
                  >
                    <User
                      className="h-5 w-5"
                      style={{
                        color:
                          embeddingToColor(selectedSpeaker.embedding_data) || "#6366f1",
                      }}
                    />
                  </div>
                  {selectedSpeaker.name}
                </SheetTitle>
                <SheetDescription>{selectedSpeaker.id}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Audio Samples
                    </div>
                    <div className="text-2xl font-bold">
                      {selectedSpeaker.audio_sample_count || 0}
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Total Duration
                    </div>
                    <div className="text-2xl font-bold">
                      {selectedSpeaker.total_audio_duration
                        ? formatDuration(selectedSpeaker.total_audio_duration)
                        : "N/A"}
                    </div>
                  </div>
                </div>

                {/* Dates */}
                {selectedSpeaker.created_at && (
                  <div>
                    <Label className="text-muted-foreground">Created</Label>
                    <p>
                      {formatTime(new Date(selectedSpeaker.created_at), timeFormat)}
                    </p>
                  </div>
                )}
                {selectedSpeaker.updated_at && (
                  <div>
                    <Label className="text-muted-foreground">Last Updated</Label>
                    <p>
                      {formatTime(new Date(selectedSpeaker.updated_at), timeFormat)}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setDetailSheetOpen(false);
                      setEnrollDialogOpen(true);
                      setEnrollName(selectedSpeaker.name);
                    }}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Add More Samples
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() => {
                      setDetailSheetOpen(false);
                      setDeleteConfirmSpeaker(selectedSpeaker);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Speaker
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteConfirmSpeaker}
        onOpenChange={(open) => !open && setDeleteConfirmSpeaker(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Speaker</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteConfirmSpeaker?.name}"? This
              action cannot be undone and will remove all associated voice data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmSpeaker(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmSpeaker && handleDelete(deleteConfirmSpeaker)}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SpeakersPage;
