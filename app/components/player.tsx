import React, { useState, useEffect, useRef } from 'react';
import { useFetcher } from '@remix-run/react';
import { create } from 'zustand';
import _, { reject } from 'lodash';

const DEFAULT_DATE = new Date();

export interface Chunk {
    start: Date;
    buffer: AudioBuffer;
    _id: string;
}

export interface DateStore {
    isPlaying: boolean;
    currentDate: Date | null;
    startDate: Date | null;
    chunks: Chunk[];
    currentChunk: Chunk | null;
    volume: number;
    setIsPlaying: (isPlaying: boolean) => void;
    toggleIsPlaying: () => void;
    updateDate: (date: Date) => void;
    resetDate: (date: Date | null) => void;
    appendChunks: (chunks: Chunk[]) => void;
    popChunk: () => Promise<Chunk | null>;
}

export const useDateStore = create<DateStore>((set) => ({
    currentDate: null,
    startDate: null,
    chunks: [],
    currentChunk: null,
    isPlaying: false,
    volume: 1,
    setIsPlaying: (isPlaying: boolean) => set({ isPlaying }),
    toggleIsPlaying: () => set(state => ({ isPlaying: !state.isPlaying })),
    updateDate: (date: Date) => set({ currentDate: date }),
    resetDate(date: Date | null) {
        set({ currentDate: date, chunks: [], startDate: date, currentChunk: null });
    },
    appendChunks(chunks: Chunk[]) {
        console.log('Appending chunks', chunks.map((chunk) => chunk.start));
        set(state => ({ chunks: [...state.chunks, ...chunks] }));
    },
    popChunk() {
        return new Promise<Chunk | null>(resolve => {
            set(state => {
                if (state.chunks.length === 0) {
                    resolve(null);
                    return {currentChunk: null, chunks: []};
                }
                const [first, ...rest] = state.chunks;
                resolve(first);
                return { chunks: rest, currentChunk: first };
            });
        });
    },
    update(data: Partial<DateStore> | ((state: DateStore) => Partial<DateStore>)) {
        set(data);
    }
}));


function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const arrayBuffer = new ArrayBuffer(binaryString.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    return arrayBuffer;
}

export const AudioPlayer: React.FC = () => {
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
    const [source, setSource] = useState<AudioBufferSourceNode | null>(null);
    const fetcher = useFetcher();
    const preloadLimit = 2; // Number of segments to preload

    const ensureAudioContext = () => {
        if (!audioContext) {
            const newAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            setAudioContext(newAudioContext);
        }
    };

    const { isPlaying, setIsPlaying, currentDate, updateDate, resetDate, appendChunks, chunks, popChunk, startDate } = useDateStore();


    if (isPlaying) {
        ensureAudioContext()
    }


    const fetchAndDecodeBuffers = async () => {
        if (fetcher.state !== 'idle') return;
        const prev = chunks[chunks.length - 1];
        const start = prev ? prev.start : currentDate;
        const lastId = prev ? prev._id : null;
        fetcher.load(`/data/audio?start=${start.toISOString()}&limit=${preloadLimit}${lastId ? `&lastId=${lastId}` : ''}`);
    };

    useEffect(() => {
        if (fetcher.data && Array.isArray((fetcher.data as { segments: any[] }).segments)) {
            const segments: any[] = (fetcher.data as { segments: any[] }).segments;

            for (let segment of segments) {
                audioContext!.decodeAudioData(base64ToArrayBuffer(segment.data)).then((audioBuffer) => {
                    appendChunks([{ buffer: audioBuffer, start: new Date(segment.start), _id: segment._id }]);
                });
            }
        }
    }, [fetcher.data]);

    const isBufferSourceCreating = useRef(false);

    const createBufferSource = async () => {
        if (!audioContext || chunks.length === 0 || isBufferSourceCreating.current) return;
    
        isBufferSourceCreating.current = true;
        
        const bufferSource = audioContext.createBufferSource();
        setSource(bufferSource);
    
        const chunk = await popChunk();
        console.log('Playing', chunk.start.toISOString());
        updateDate(chunk.start);
        bufferSource.buffer = chunk.buffer;
        bufferSource.connect(audioContext.destination);
    
        bufferSource.start();
    
        bufferSource.onended = () => {
            setSource(null);
        };        

        isBufferSourceCreating.current = false;
    };
    
    useEffect(() => {
        if (source) {
            source.stop();
            setSource(null);
        }
    }, [startDate]);


    useEffect(() => {
        if (!audioContext) return;

        

        if (isPlaying && chunks.length && !source) {
            createBufferSource();
        }

        if (!isPlaying && source) {
            source.stop();
            setSource(null);
        }
    }, [isPlaying, chunks, source]);


    useEffect(() => {
        if (isPlaying && chunks.length < 3) {
            fetchAndDecodeBuffers();
        }
    }, [isPlaying, chunks]);

    return <></>
}
