import React, { useEffect, useRef } from "react";
import { create } from "zustand";
import _ from "lodash";
import { apiClient } from "@/lib/api.ts";
import { useSettingsStore } from "@/stores/settingsStore.ts";

// #region agent log
const _dbg = (loc: string, msg: string, data: Record<string, unknown>) => console.warn(`[DBG] ${loc} | ${msg}`, JSON.stringify(data));
// #endregion

export interface Chunk {
  start: Date;
  buffer: AudioBuffer;
  _id: string;
}

export interface DateStore {
  isPlaying: boolean;
  currentDate: Date | null;
  startDate: Date | null;
  seekTarget: Date | null;
  seekGeneration: number;
  chunks: Chunk[];
  currentChunk: Chunk | null;
  audioContext: AudioContext | null;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  isCreatingSource: boolean;
  rafId: number | null;
  baselineStartDate: Date | null;
  baselineStartCtxTime: number | null;
  setIsPlaying: (isPlaying: boolean) => void;
  toggleIsPlaying: () => void;
  updateDate: (date: Date) => void;
  resetDate: (date: Date | null) => void;
  appendChunks: (chunks: Chunk[], generation: number) => void;
  popChunk: () => Promise<Chunk | null>;
  setAudioContext: (ctx: AudioContext | null) => void;
  setSourceNode: (node: AudioBufferSourceNode | null) => void;
  setGainNode: (node: GainNode | null) => void;
  setIsCreatingSource: (isCreating: boolean) => void;
  setRafId: (id: number | null) => void;
  setBaselines: (date: Date, ctxTime: number) => void;
  clearBaselines: () => void;
  update: (
    data: Partial<DateStore> | ((state: DateStore) => Partial<DateStore>),
  ) => void;
}

export const useAudioPlayer = create<DateStore>((set) => ({
  currentDate: null,
  startDate: null,
  seekTarget: null,
  seekGeneration: 0,
  chunks: [],
  currentChunk: null,
  isPlaying: false,
  audioContext: null,
  sourceNode: null,
  gainNode: null,
  isCreatingSource: false,
  rafId: null,
  baselineStartDate: null,
  baselineStartCtxTime: null,
  setIsPlaying: (isPlaying: boolean) => set({ isPlaying }),
  toggleIsPlaying: () => set((state) => {
    // #region agent log
    _dbg('toggleIsPlaying', 'toggling', { from: state.isPlaying, to: !state.isPlaying });
    // #endregion
    return { isPlaying: !state.isPlaying };
  }),
  updateDate: (date: Date) => set({ currentDate: date }),
  resetDate(date: Date | null) {
    const state = useAudioPlayer.getState();

    if (state.sourceNode) {
      try {
        state.sourceNode.onended = null; // Prevent async callback
        state.sourceNode.stop();
        state.sourceNode.disconnect();
      } catch (e) {
        // Ignore errors if already stopped
      }
    }

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }

    set({
      currentDate: date,
      chunks: [],
      startDate: date,
      seekTarget: date,
      seekGeneration: state.seekGeneration + 1,
      currentChunk: null,
      baselineStartDate: null,
      baselineStartCtxTime: null,
      sourceNode: null,
      rafId: null,
      isCreatingSource: false,
    });
  },
  appendChunks(chunks: Chunk[], generation: number) {
    set((state) => {
      if (generation !== state.seekGeneration) {
        return {};
      }
      const combined = [...state.chunks, ...chunks];
      combined.sort((a, b) => a.start.getTime() - b.start.getTime());
      return { chunks: combined };
    });
  },
  popChunk() {
    return new Promise<Chunk | null>((resolve) => {
      set((state) => {
        if (state.chunks.length === 0) {
          resolve(null);
          return { currentChunk: null, chunks: [] };
        }
        const [first, ...rest] = state.chunks;
        resolve(first);
        return { chunks: rest, currentChunk: first };
      });
    });
  },
  setAudioContext: (ctx: AudioContext | null) => set({ audioContext: ctx }),
  setSourceNode: (node: AudioBufferSourceNode | null) =>
    set({ sourceNode: node }),
  setGainNode: (node: GainNode | null) => set({ gainNode: node }),
  setIsCreatingSource: (isCreating: boolean) =>
    set({ isCreatingSource: isCreating }),
  setRafId: (id: number | null) => set({ rafId: id }),
  setBaselines: (date: Date, ctxTime: number) =>
    set({ baselineStartDate: date, baselineStartCtxTime: ctxTime }),
  clearBaselines: () =>
    set({ baselineStartDate: null, baselineStartCtxTime: null }),
  update(
    data: Partial<DateStore> | ((state: DateStore) => Partial<DateStore>),
  ) {
    set(data);
  },
}));

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = globalThis.atob(base64);
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  return arrayBuffer;
}

export const AudioPlayer: React.FC = () => {
  const {
    appendChunks,
    audioContext,
    chunks,
    currentDate,
    gainNode,
    isCreatingSource,
    isPlaying,
    popChunk,
    setAudioContext,
    setBaselines,
    setGainNode,
    setIsCreatingSource,
    setSourceNode,
    sourceNode,
    startDate,
    updateDate,
  } = useAudioPlayer();
  
  // Get volume and playbackRate from settings store
  const { volume, playbackRate } = useSettingsStore();
  const preloadLimit = 20; // Number of segments to preload

  useEffect(() => {
    if (isPlaying && !audioContext) {
      const newAudioContext =
        new (globalThis.AudioContext || (window as any).webkitAudioContext)();
      setAudioContext(newAudioContext);
    }
  }, [isPlaying, audioContext]);

  const loadingRef = useRef(false)

  const fetchAndDecodeBuffers = async () => {
    if (loadingRef.current) return;
    if (!audioContext) return;

    const currentGeneration = useAudioPlayer.getState().seekGeneration;

    const prev = chunks[chunks.length - 1];
    const start = prev ? prev.start : currentDate;
    if (!start) return;

    try {
      loadingRef.current = true
      const lastId = prev ? prev._id : null;
      // #region agent log
      _dbg('fetchAndDecode:request', 'API request', { startMs: start.getTime(), startISO: start.toISOString(), hasPrev: !!prev, seekTarget: useAudioPlayer.getState().seekTarget?.toISOString(), currentDate: currentDate?.toISOString(), seekGen: currentGeneration });
      // #endregion
      const resp = await apiClient.get(
        `/data/audio?start=${start.getTime()}&limit=${preloadLimit}${
          lastId ? `&lastId=${lastId}` : ""
        }`,
      );

      if (useAudioPlayer.getState().seekGeneration !== currentGeneration) {
        return;
      }

      if (
        resp &&
        Array.isArray((resp as { segments: any[] }).segments)
      ) {
        const segments: any[] = (resp as { segments: any[] }).segments;
        // #region agent log
        _dbg('fetchAndDecode:response', 'API response segments', { count: segments.length, firstStart: segments[0] ? new Date(segments[0].start).toISOString() : null, lastStart: segments[segments.length - 1] ? new Date(segments[segments.length - 1].start).toISOString() : null, requestedStart: start.toISOString() });
        // #endregion

        for (const segment of segments) {
          audioContext.decodeAudioData(base64ToArrayBuffer(segment.data)).then(
            (audioBuffer) => {
              appendChunks([{
                buffer: audioBuffer,
                start: new Date(segment.start),
                _id: segment._id,
              }], currentGeneration);
            },
          );
        }
      }
    } finally {
      loadingRef.current = false
    }
  };

  useEffect(() => {
    if (audioContext && !gainNode) {
      const newGainNode = audioContext.createGain();
      newGainNode.gain.value = 1; // Default gain value
      newGainNode.connect(audioContext.destination);
      setGainNode(newGainNode);
    }
  }, [audioContext, gainNode]);

  useEffect(() => {
    if (gainNode) {
      gainNode.gain.value = volume;
    }
  }, [volume, gainNode]);

  useEffect(() => {
    if (sourceNode && audioContext && sourceNode.playbackRate.value !== playbackRate) {
      sourceNode.playbackRate.value = playbackRate;
      
      // if (isPlaying && currentDate && audioContext) {
      //   setBaselines(currentDate, audioContext.currentTime);
      // }
    }
  }, [playbackRate, sourceNode, isPlaying, currentDate, audioContext]);

  const createBufferSource = async () => {
    // Read isCreatingSource from store (not closure) to prevent race conditions
    // from React StrictMode double-invocation or rapid re-renders
    const storeIsCreating = useAudioPlayer.getState().isCreatingSource;

    // #region agent log
    _dbg('createBufferSource:entry', 'called', { chunksLen: chunks.length, isCreatingSource: storeIsCreating, closureIsCreating: isCreatingSource, hasSourceNode: !!sourceNode, seekGen: useAudioPlayer.getState().seekGeneration });
    // #endregion

    if (
      !audioContext || chunks.length === 0 || storeIsCreating
    ) return;

    // #region agent log
    _dbg('createBufferSource:proceed', 'passed guard', { seekGen: useAudioPlayer.getState().seekGeneration });
    // #endregion

    setIsCreatingSource(true);

    const { seekTarget } = useAudioPlayer.getState();

    let chunk = await popChunk();
    if (!chunk) {
      setIsCreatingSource(false);
      return;
    }

    if (seekTarget) {
      let chunkEndTime = chunk.start.getTime() + (chunk.buffer.duration * 1000);
      while (chunk && seekTarget.getTime() > chunkEndTime) {
        chunk = await popChunk();
        if (!chunk) {
          setIsCreatingSource(false);
          return;
        }
        chunkEndTime = chunk.start.getTime() + (chunk.buffer.duration * 1000);
      }
    }

    const bufferSource = audioContext.createBufferSource();
    setSourceNode(bufferSource);
    bufferSource.buffer = chunk.buffer;
    bufferSource.connect(gainNode!);

    const when = audioContext.currentTime;
    let offset = 0;
    let actualStartDate = chunk.start;

    if (seekTarget && seekTarget.getTime() > chunk.start.getTime()) {
      offset = (seekTarget.getTime() - chunk.start.getTime()) / 1000;
      if (offset < chunk.buffer.duration) {
        actualStartDate = seekTarget;
      }
    }

    // #region agent log
    _dbg('createBufferSource:seek', 'seek calculation', { seekTarget: seekTarget?.toISOString(), chunkStart: chunk.start.toISOString(), chunkDuration: Math.round(chunk.buffer.duration * 1000) / 1000, offset: Math.round(offset * 1000) / 1000, actualStartDate: actualStartDate.toISOString(), seekTargetMs: seekTarget?.getTime(), chunkStartMs: chunk.start.getTime(), diff: seekTarget ? seekTarget.getTime() - chunk.start.getTime() : null });
    // #endregion

    bufferSource.start(when, offset);

    useAudioPlayer.getState().setBaselines(actualStartDate, when);
    useAudioPlayer.getState().update({ seekTarget: null });
    updateDate(actualStartDate);

    // #region agent log
    const _srcId = Math.random().toString(36).slice(2, 8);
    _dbg('createBufferSource:started', 'source STARTED', { _srcId, seekGen: useAudioPlayer.getState().seekGeneration });
    // #endregion

    bufferSource.onended = () => {
      // Only act if this source is still the current one (identity check).
      // If a new source was created or we manually stopped, this is a no-op.
      const currentSrc = useAudioPlayer.getState().sourceNode;
      // #region agent log
      _dbg('onended', 'onended fired', { _srcId, isSameSource: currentSrc === bufferSource, hasCurrentSource: !!currentSrc, seekGen: useAudioPlayer.getState().seekGeneration });
      // #endregion
      if (currentSrc === bufferSource) {
        setSourceNode(null);
        setIsCreatingSource(false);
      }
    };
  };

  useEffect(() => {
    if (sourceNode) {
      sourceNode.onended = null; // Prevent async callback
      sourceNode.stop();
      sourceNode.disconnect();
      setSourceNode(null);
      setIsCreatingSource(false);
    }
  }, [startDate]);

  useEffect(() => {
    if (!audioContext) return;

    // #region agent log
    _dbg('mainEffect', 'main playback effect', { isPlaying, chunksLen: chunks.length, hasSourceNode: !!sourceNode, isCreatingSource, seekGen: useAudioPlayer.getState().seekGeneration });
    // #endregion

    if (isPlaying && chunks.length && !sourceNode) {
      createBufferSource();
    }

    if (!isPlaying && sourceNode) {
      // Save current position so resume re-fetches from here instead of
      // skipping to the next chunk (which may be 10+ seconds later)
      const pausedDate = useAudioPlayer.getState().currentDate;
      // #region agent log
      _dbg('mainEffect:stop', 'pausing - saving position & clearing chunks', { seekGen: useAudioPlayer.getState().seekGeneration, pausedDate: pausedDate?.toISOString(), chunksLeft: chunks.length });
      // #endregion
      sourceNode.onended = null; // Prevent async callback
      sourceNode.stop();
      sourceNode.disconnect();
      setSourceNode(null);
      setIsCreatingSource(false);
      // Clear chunks/baselines and set seekTarget so resume re-fetches from paused position
      useAudioPlayer.getState().update({
        seekTarget: pausedDate,
        chunks: [],
        baselineStartDate: null,
        baselineStartCtxTime: null,
        seekGeneration: useAudioPlayer.getState().seekGeneration + 1,
      });
    }
  }, [isPlaying, chunks, sourceNode, audioContext]);

  useEffect(() => {
    if (isPlaying && chunks.length < 3 && audioContext) {
      fetchAndDecodeBuffers();
    }
  }, [isPlaying, chunks, audioContext]);

  useEffect(() => {
    if (!audioContext) return;

    let frameId: number | null = null;

    if (!isPlaying) {
      if (frameId) cancelAnimationFrame(frameId);
      return;
    }

    // #region agent log
    let _tickCount = 0;
    // #endregion
    const tick = () => {
      const { baselineStartDate, baselineStartCtxTime } = useAudioPlayer.getState();
      const currentPlaybackRate = useSettingsStore.getState().playbackRate;
      if (baselineStartDate && baselineStartCtxTime !== null) {
        const elapsed = audioContext.currentTime - baselineStartCtxTime;
        const newDate = new Date(baselineStartDate.getTime() + elapsed * currentPlaybackRate * 1000);
        // #region agent log
        if (_tickCount < 3) { _dbg('tick', 'position update', { elapsed: Math.round(elapsed * 1000) / 1000, ctxTime: Math.round(audioContext.currentTime * 1000) / 1000, baseCtxTime: Math.round(baselineStartCtxTime * 1000) / 1000, baseDate: baselineStartDate.toISOString(), newDate: newDate.toISOString() }); _tickCount++; }
        // #endregion
        updateDate(newDate);
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [isPlaying, audioContext]);

  return null;
};
