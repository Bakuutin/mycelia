export { BaseTrack } from "./BaseTrack";
export { TrackHeader } from "./TrackHeader";
export {
  VOICE_DETECTION_CONFIG,
  VoiceDetectionTrack,
} from "./VoiceDetectionTrack";
export { DATA_PRESENCE_CONFIG, DataPresenceTrack } from "./DataPresenceTrack";
export {
  AUDIO_CHUNKS_CONFIG,
  AudioChunksTrack,
  DIARIZATION_COVERAGE_CONFIG,
  DiarizationCoverageTrack,
  DIARIZATIONS_CONFIG,
  DiarizationsTrack,
  TRANSCRIPTIONS_CONFIG,
  TranscriptionsTrack,
} from "./HistogramTrack";
export { LOCATIONS_CONFIG, LocationTrack } from "./LocationTrack";
export { PHOTOS_CONFIG, PhotosTrack } from "./PhotosTrack";

import type { Track } from "@/types/tracks";
import { LOCATIONS_CONFIG, LocationTrack } from "./LocationTrack";
import { PHOTOS_CONFIG, PhotosTrack } from "./PhotosTrack";
import {
  VOICE_DETECTION_CONFIG,
  VoiceDetectionTrack,
} from "./VoiceDetectionTrack";
import { DATA_PRESENCE_CONFIG, DataPresenceTrack } from "./DataPresenceTrack";
import {
  AUDIO_CHUNKS_CONFIG,
  AudioChunksTrack,
  DIARIZATION_COVERAGE_CONFIG,
  DiarizationCoverageTrack,
  DIARIZATIONS_CONFIG,
  DiarizationsTrack,
  TRANSCRIPTIONS_CONFIG,
  TranscriptionsTrack,
} from "./HistogramTrack";

// Registry of all available tracks (excluding Objects which is handled separately)
export const TRACK_REGISTRY: Track[] = [
  { config: VOICE_DETECTION_CONFIG, component: VoiceDetectionTrack },
  { config: DATA_PRESENCE_CONFIG, component: DataPresenceTrack },
  { config: TRANSCRIPTIONS_CONFIG, component: TranscriptionsTrack },
  { config: AUDIO_CHUNKS_CONFIG, component: AudioChunksTrack },
  {
    config: DIARIZATION_COVERAGE_CONFIG,
    component: DiarizationCoverageTrack,
  },
  { config: DIARIZATIONS_CONFIG, component: DiarizationsTrack },
  { config: LOCATIONS_CONFIG, component: LocationTrack },
  { config: PHOTOS_CONFIG, component: PhotosTrack },
];
