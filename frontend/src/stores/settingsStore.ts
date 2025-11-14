import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

type TimeFormat =
  | "gregorian-local-iso"
  | "gregorian-local-verbose"
  | "gregorian-local-european"
  | "gregorian-local-american"
  | "gregorian-utc-iso"
  | "gregorian-utc-verbose"
  | "gregorian-utc-european"
  | "gregorian-utc-american"
  | "si-int"
  | "si-formatted";

interface SettingsState {
  apiEndpoint: string;
  clientId: string;
  clientSecret: string;
  theme: Theme;
  timeFormat: TimeFormat;
  transcriptThresholdHours: number;
  preferredAudioDeviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  playbackRate: number;
  volume: number;
  setApiEndpoint: (endpoint: string) => void;
  setClientId: (id: string) => void;
  setClientSecret: (secret: string) => void;
  setTheme: (theme: Theme) => void;
  setTimeFormat: (format: TimeFormat) => void;
  setTranscriptThresholdHours: (hours: number) => void;
  setPreferredAudioDeviceId: (deviceId: string | null) => void;
  setEchoCancellation: (enabled: boolean) => void;
  setNoiseSuppression: (enabled: boolean) => void;
  setAutoGainControl: (enabled: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  clearSettings: () => void;
}

function getDefaultApiEndpoint(): string {
  if (
    typeof window !== "undefined" && window.location.hostname === "localhost" &&
    window.location.port === "8080"
  ) {
    return "http://host.docker.internal:5173";
  }
  return "http://localhost:5173";
}

const DEFAULT_API_ENDPOINT = getDefaultApiEndpoint();
const DEFAULT_TIME_FORMAT: TimeFormat = "gregorian-local-iso";
const DEFAULT_TRANSCRIPT_THRESHOLD_HOURS = 12;
const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_VOLUME = 1;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiEndpoint: DEFAULT_API_ENDPOINT,
      clientId: "",
      clientSecret: "",
      theme: "system",
      timeFormat: DEFAULT_TIME_FORMAT,
      transcriptThresholdHours: DEFAULT_TRANSCRIPT_THRESHOLD_HOURS,
      preferredAudioDeviceId: null,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      playbackRate: DEFAULT_PLAYBACK_RATE,
      volume: DEFAULT_VOLUME,
      setApiEndpoint: (endpoint) => set({ apiEndpoint: endpoint }),
      setClientId: (id) => set({ clientId: id }),
      setClientSecret: (secret) => set({ clientSecret: secret }),
      setTheme: (theme) => set({ theme }),
      setTimeFormat: (format) => set({ timeFormat: format }),
      setTranscriptThresholdHours: (hours) =>
        set({ transcriptThresholdHours: hours }),
      setPreferredAudioDeviceId: (deviceId) =>
        set({ preferredAudioDeviceId: deviceId }),
      setEchoCancellation: (enabled) => set({ echoCancellation: enabled }),
      setNoiseSuppression: (enabled) => set({ noiseSuppression: enabled }),
      setAutoGainControl: (enabled) => set({ autoGainControl: enabled }),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      setVolume: (volume) => set({ volume }),
      clearSettings: () =>
        set({
          apiEndpoint: DEFAULT_API_ENDPOINT,
          clientId: "",
          clientSecret: "",
          theme: "system",
          timeFormat: DEFAULT_TIME_FORMAT,
          transcriptThresholdHours: DEFAULT_TRANSCRIPT_THRESHOLD_HOURS,
          preferredAudioDeviceId: null,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          playbackRate: DEFAULT_PLAYBACK_RATE,
          volume: DEFAULT_VOLUME,
        }),
    }),
    {
      name: "mycelia-settings",
    },
  ),
);

export type { TimeFormat };
