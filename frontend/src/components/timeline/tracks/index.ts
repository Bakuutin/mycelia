export { BaseTrack } from "./BaseTrack";
export { TrackHeader } from "./TrackHeader";
export {
  VoiceDetectionTrack,
  VOICE_DETECTION_CONFIG,
} from "./VoiceDetectionTrack";
export { DataPresenceTrack, DATA_PRESENCE_CONFIG } from "./DataPresenceTrack";
export {
  TranscriptionsTrack,
  AudioChunksTrack,
  DiarizationsTrack,
  TRANSCRIPTIONS_CONFIG,
  AUDIO_CHUNKS_CONFIG,
  DIARIZATIONS_CONFIG,
} from "./HistogramTrack";

import type { Track } from "@/types/tracks";
import { VoiceDetectionTrack, VOICE_DETECTION_CONFIG } from "./VoiceDetectionTrack";
import { DataPresenceTrack, DATA_PRESENCE_CONFIG } from "./DataPresenceTrack";
import {
  TranscriptionsTrack,
  AudioChunksTrack,
  DiarizationsTrack,
  TRANSCRIPTIONS_CONFIG,
  AUDIO_CHUNKS_CONFIG,
  DIARIZATIONS_CONFIG,
} from "./HistogramTrack";

// Registry of all available tracks (excluding Objects which is handled separately)
export const TRACK_REGISTRY: Track[] = [
  { config: VOICE_DETECTION_CONFIG, component: VoiceDetectionTrack },
  { config: DATA_PRESENCE_CONFIG, component: DataPresenceTrack },
  { config: TRANSCRIPTIONS_CONFIG, component: TranscriptionsTrack },
  { config: AUDIO_CHUNKS_CONFIG, component: AudioChunksTrack },
  { config: DIARIZATIONS_CONFIG, component: DiarizationsTrack },
];
