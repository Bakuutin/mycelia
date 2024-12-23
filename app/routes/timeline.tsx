import _ from 'lodash';
import { useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { Timeline } from 'vis-timeline/dist/vis-timeline-graph2d.esm.js';
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import { useEffect, useRef, useState } from "react";
import { MongoClient } from "mongodb";
import { LoaderFunctionArgs } from '@remix-run/node';

interface TimelineItem {
  id: string;
  start: string;
  end: string;
}

// Types for loader data
type LoaderData = {
  items: TimelineItem[];
  start: string;
  end: string;
};

function getDefaultStartDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate() {
  return new Date().toISOString().split('T')[0];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const visibleStart = url.searchParams.get('start') || getDefaultStartDate();
  const visibleEnd = url.searchParams.get('end') || getDefaultEndDate();

  // Validate dates
  if (!Date.parse(visibleStart) || !Date.parse(visibleEnd)) {
    throw new Response("Invalid date format", { status: 400 });
  }

  const client = new MongoClient(process.env.MONGO_URL as string);

  const [start, end] = [visibleStart, visibleEnd].map(date => new Date(date));

  try {
    await client.connect();
    const database = client.db("a5t-2024-11-19");
    const collection = database.collection("source_files");

    const items = await collection.find({
      start: {
        $lte: end,
      },
      end: {
        $gte: start,
      },
    })
    .sort({ start: -1 })
    .limit(1000)
    .toArray();

    const timelineData = items.map(item => ({
      id: item._id.toString(),
      start: item.start,
      end: item.end,
    }));

    // Return JSON response with proper typing
    return ({
      items: timelineData,
      start: visibleStart,
      end: visibleEnd,
    });
  } catch (error) {
    throw new Response("Database error", { status: 500 });
  } finally {
    await client.close();
  }
}

export default function TimelinePage() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const { items, start, end } = useLoaderData<LoaderData>();
  const navigation = useNavigation();
  const submit = useSubmit();

  // Initialize timeline
  useEffect(() => {
    if (!timelineRef.current) return;

    const timelineInstance = new Timeline(
      timelineRef.current,
      items,
      {
        height: '300px',
        start: new Date(start),
        end: new Date(end),
      }
    );

    setTimeline(timelineInstance);

    return () => {
      timelineInstance.destroy();
    };
  }, [timelineRef.current]);

  // Update timeline items when data changes
  useEffect(() => {
    if (timeline) {
      timeline.setItems(items);
    }
  }, [items]);

  // Handle range changes
  useEffect(() => {
    if (!timeline) return;

    const handleRangeChange = _.debounce((properties: any) => {
      const formData = new FormData();
      formData.append('start', properties.start.toISOString().split('T')[0]);
      formData.append('end', properties.end.toISOString().split('T')[0]);
      
      submit(formData, {
        method: 'get',
        preventScrollReset: true,
      });
    }, 500);

    let hasMarker = false;

    timeline.on('rangechange', handleRangeChange);
    timeline.on("doubleClick", function ({time}: {time: Date}) {
      console.log('click', time);

      if (hasMarker) {
        timeline.removeCustomTime('cursor');
        hasMarker = false;
      } else {
        timeline.addCustomTime(time, 'cursor');
        hasMarker = true;
      }
    });

    return () => {
      timeline.off('rangechange', handleRangeChange);
    };
  }, [timeline, submit]);

  const isLoading = navigation.state === "loading";

  return (
    <div className="h-screen p-4">
      {isLoading && (
        <div className="absolute top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded">
          Loading...
        </div>
      )}
      <div 
        ref={timelineRef} 
        className="w-full h-full border rounded-lg shadow-lg relative"
      />
    </div>
  );
}