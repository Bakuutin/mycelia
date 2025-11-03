import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

type TimeFormat =
  | 'gregorian-local-iso'
  | 'gregorian-local-verbose'
  | 'gregorian-local-european'
  | 'gregorian-local-american'
  | 'gregorian-utc-iso'
  | 'gregorian-utc-verbose'
  | 'gregorian-utc-european'
  | 'gregorian-utc-american'
  | 'si-int'
  | 'si-formatted';

interface SettingsState {
  apiEndpoint: string;
  clientId: string;
  clientSecret: string;
  theme: Theme;
  timeFormat: TimeFormat;
  transcriptThresholdHours: number;
  setApiEndpoint: (endpoint: string) => void;
  setClientId: (id: string) => void;
  setClientSecret: (secret: string) => void;
  setTheme: (theme: Theme) => void;
  setTimeFormat: (format: TimeFormat) => void;
  setTranscriptThresholdHours: (hours: number) => void;
  clearSettings: () => void;
}

function getDefaultApiEndpoint(): string {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port === '8080') {
    return 'http://host.docker.internal:5173';
  }
  return 'http://localhost:5173';
}

const DEFAULT_API_ENDPOINT = getDefaultApiEndpoint();
const DEFAULT_TIME_FORMAT: TimeFormat = 'gregorian-local-iso';
const DEFAULT_TRANSCRIPT_THRESHOLD_HOURS = 12;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiEndpoint: DEFAULT_API_ENDPOINT,
      clientId: '',
      clientSecret: '',
      theme: 'system',
      timeFormat: DEFAULT_TIME_FORMAT,
      transcriptThresholdHours: DEFAULT_TRANSCRIPT_THRESHOLD_HOURS,
      setApiEndpoint: (endpoint) => set({ apiEndpoint: endpoint }),
      setClientId: (id) => set({ clientId: id }),
      setClientSecret: (secret) => set({ clientSecret: secret }),
      setTheme: (theme) => set({ theme }),
      setTimeFormat: (format) => set({ timeFormat: format }),
      setTranscriptThresholdHours: (hours) => set({ transcriptThresholdHours: hours }),
      clearSettings: () => set({
        apiEndpoint: DEFAULT_API_ENDPOINT,
        clientId: '',
        clientSecret: '',
        theme: 'system',
        timeFormat: DEFAULT_TIME_FORMAT,
        transcriptThresholdHours: DEFAULT_TRANSCRIPT_THRESHOLD_HOURS,
      }),
    }),
    {
      name: 'mycelia-settings',
    }
  )
);

export type { TimeFormat };
