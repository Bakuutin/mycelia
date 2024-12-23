import React, { useState, useEffect, useRef } from 'react';
import { useFetcher } from '@remix-run/react';
import { client, DATABASE_NAME } from '../mongo'
import { c } from 'node_modules/vite/dist/node/types.d-aGj9QkWt';

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const startParam = url.searchParams.get('start');
    const limitParam = url.searchParams.get('limit');

    if (!startParam) {
        console.log('No start parameter');
        return { segments: [] };
    }


    const startDate = new Date(startParam);
    const limit = parseInt(limitParam || '5', 10);
    if (isNaN(startDate.getTime())) {
        throw new Response('Invalid start parameter', { status: 400 });
    }

    if (isNaN(limit) || limit <= 0) {
        throw new Response('Invalid limit parameter', { status: 400 });
    }

    try {
        await client.connect();
        const db = client.db(DATABASE_NAME);
        const collection = db.collection('audio_chunks');

        const segments = await collection
            .find({
                // start: { $lte: startDate  },
                start: { $gte: startDate },
            })
            .sort({ start: 1 })
            .limit(limit)
            .toArray();

        const formattedSegments = segments.map(segment => ({
            start: segment.start,
            data: segment.data.buffer.toString('base64'),
        }));

        return ({ segments: formattedSegments });
    } catch (error) {
        console.error(error);
        throw new Response('Failed to fetch segments', { status: 500 });
    } finally {
        await client.close();
    }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    // Remove data URL prefix if present (e.g., "data:audio/wav;base64,")

    // Convert base64 to binary string
    const binaryString = window.atob(base64);

    // Create an ArrayBuffer from the binary string
    const arrayBuffer = new ArrayBuffer(binaryString.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    // Fill the ArrayBuffer with the binary data
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    return arrayBuffer;
}


const AudioPlayer = ({ startDate }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    let [audioContext, setAudioContext] = useState<any>(null);
    const [source, setSource] = useState(null);
    const bufferQueue = useRef([]);
    const currentPlaybackTime = useRef(0);
    const startDateRef = useRef(null);
    const fetcher = useFetcher();
    const preloadLimit = 2; // Number of segments to preload

    useEffect(() => {
        if (startDate !== startDateRef.current) {
            startDateRef.current = startDate;
            bufferQueue.current = [];
            fetchAndDecodeBuffers(startDate);
        }
    }, [startDate]);

    const fetchAndDecodeBuffers = async (start: Date) => {
        if (!audioContext) return;

        // Fetch audio segments from the backend
        fetcher.load(`/audio?start=${start.toISOString()}&limit=${preloadLimit}`);

        // Wait for the fetcher to resolve the data
        if (fetcher.data && Array.isArray(fetcher.data.segments)) {
            const { segments } = fetcher.data;

            console.log('segments', segments);

            for (let segment of segments) {
                const audioBuffer = await audioContext.decodeAudioData(base64ToArrayBuffer(segment.data));
                bufferQueue.current.push({ buffer: audioBuffer, start: new Date(segment.start) });
            }
        }
    };

    const playAudio = () => {
        console.log('playAudio');
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            setAudioContext(audioContext);
            fetchAndDecodeBuffers(startDate);
            console.log('audioContext', audioContext);
        }

        if (!audioContext || bufferQueue.current.length === 0 || isPlaying) return;

        const now = audioContext.currentTime;
        let offsetTime = 0;

        while (bufferQueue.current.length) {
            const { buffer, start } = bufferQueue.current.shift();
            const bufferSource = audioContext.createBufferSource();
            console.log('buffer', buffer);
            bufferSource.buffer = buffer;

            // Connect to the destination (speakers)
            bufferSource.connect(audioContext.destination);

            // Schedule playback
            const playbackStartTime = now + offsetTime;
            const playbackOffset = (startDate - start) / 1000; // Convert milliseconds to seconds
            bufferSource.start(playbackStartTime, Math.max(0, playbackOffset));

            offsetTime += buffer.duration;

            // Keep reference to source to allow stopping
            if (!source) {
                setSource(bufferSource);
            }
        }

        setIsPlaying(true);
    };

    const stopAudio = () => {
        if (source) {
            source.stop();
            setSource(null);
        }
        setIsPlaying(false);
    };

    useEffect(() => {
        if (isPlaying && bufferQueue.current.length < preloadLimit / 2) {
            fetchAndDecodeBuffers(new Date(startDate.getTime() + currentPlaybackTime.current * 1000));
        }
    }, [isPlaying]);

    return (
        <div>
            <button onClick={isPlaying ? stopAudio : playAudio}>
                {isPlaying ? 'Stop' : 'Play'}
            </button>
        </div>
    );
};


const startDate = new Date('2024-12-05T13:00:00Z');

const Audio = () => {
    return <AudioPlayer startDate={startDate} />;
}

export default Audio;
