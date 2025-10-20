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
  setApiEndpoint: (endpoint: string) => void;
  setClientId: (id: string) => void;
  setClientSecret: (secret: string) => void;
  setTheme: (theme: Theme) => void;
  setTimeFormat: (format: TimeFormat) => void;
  clearSettings: () => void;
}

const DEFAULT_API_ENDPOINT = 'http://localhost:8000';
const DEFAULT_TIME_FORMAT: TimeFormat = 'gregorian-local-iso';

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiEndpoint: DEFAULT_API_ENDPOINT,
      clientId: '',
      clientSecret: '',
      theme: 'system',
      timeFormat: DEFAULT_TIME_FORMAT,
      setApiEndpoint: (endpoint) => set({ apiEndpoint: endpoint }),
      setClientId: (id) => set({ clientId: id }),
      setClientSecret: (secret) => set({ clientSecret: secret }),
      setTheme: (theme) => set({ theme }),
      setTimeFormat: (format) => set({ timeFormat: format }),
      clearSettings: () => set({
        apiEndpoint: DEFAULT_API_ENDPOINT,
        clientId: '',
        clientSecret: '',
        theme: 'system',
        timeFormat: DEFAULT_TIME_FORMAT,
      }),
    }),
    {
      name: 'mycelia-settings',
    }
  )
);

export type { TimeFormat };
