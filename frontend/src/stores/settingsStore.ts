import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

type WaveformScope = "full" | "playhead";

type TimeFormat =
  | "gregorian-local-natural"
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
  autoSave: boolean;
  waveformScope: WaveformScope;
  followPlayback: boolean;
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
  setAutoSave: (enabled: boolean) => void;
  setWaveformScope: (scope: WaveformScope) => void;
  setFollowPlayback: (enabled: boolean) => void;
  clearSettings: () => void;
}

function getDefaultApiEndpoint(): string {
  return "https://localhost:4433";
}

const DEFAULT_API_ENDPOINT = getDefaultApiEndpoint();
const DEFAULT_TIME_FORMAT: TimeFormat = "gregorian-local-natural";
const DEFAULT_TRANSCRIPT_THRESHOLD_HOURS = 12;
const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_VOLUME = 1;
const DEFAULT_WAVEFORM_SCOPE: WaveformScope = "full";

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
      autoSave: true,
      waveformScope: DEFAULT_WAVEFORM_SCOPE,
      followPlayback: false,
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
      setAutoSave: (enabled) => set({ autoSave: enabled }),
      setWaveformScope: (scope) => set({ waveformScope: scope }),
      setFollowPlayback: (enabled) => set({ followPlayback: enabled }),
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
          autoSave: true,
          waveformScope: DEFAULT_WAVEFORM_SCOPE,
          followPlayback: false,
        }),
    }),
    {
      name: "mycelia-settings",
    },
  ),
);

export type { TimeFormat, WaveformScope };
