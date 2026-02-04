import { create } from "zustand";

export type RecordingStep =
  | "idle"
  | "mic"
  | "websocket"
  | "audio-start"
  | "streaming"
  | "stopping"
  | "error";

interface RecordingState {
  // Observable state
  isRecording: boolean;
  currentStep: RecordingStep;
  recordingDuration: number;
  error: string | null;
  deviceLabel: string | null;
  sampleRate: number;

  // Actions
  setIsRecording: (isRecording: boolean) => void;
  setCurrentStep: (step: RecordingStep) => void;
  setRecordingDuration: (duration: number) => void;
  setError: (error: string | null) => void;
  setDeviceLabel: (label: string | null) => void;
  setSampleRate: (rate: number) => void;
  reset: () => void;
}

// Resource refs stored outside zustand (not serializable)
interface RecordingResources {
  wsRef: WebSocket | null;
  mediaStreamRef: MediaStream | null;
  audioContextRef: AudioContext | null;
  analyserRef: AnalyserNode | null;
  workletNodeRef: AudioWorkletNode | null;
  durationIntervalRef: number | null;
  keepAliveIntervalRef: number | null;
  stopRecordingFn: (() => void) | null;
}

// Global resources (not in zustand, but accessible)
export const recordingResources: RecordingResources = {
  wsRef: null,
  mediaStreamRef: null,
  audioContextRef: null,
  analyserRef: null,
  workletNodeRef: null,
  durationIntervalRef: null,
  keepAliveIntervalRef: null,
  stopRecordingFn: null,
};

const initialState = {
  isRecording: false,
  currentStep: "idle" as RecordingStep,
  recordingDuration: 0,
  error: null,
  deviceLabel: null,
  sampleRate: 16000,
};

export const useRecordingStore = create<RecordingState>()((set) => ({
  ...initialState,

  setIsRecording: (isRecording) => set({ isRecording }),
  setCurrentStep: (currentStep) => set({ currentStep }),
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  setError: (error) => set({ error }),
  setDeviceLabel: (deviceLabel) => set({ deviceLabel }),
  setSampleRate: (sampleRate) => set({ sampleRate }),
  reset: () => set(initialState),
}));

// Helper to format duration
export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};
