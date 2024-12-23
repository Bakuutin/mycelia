import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useFetcher, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import * as d3 from 'd3';
import _ from 'lodash';
import { LoaderFunctionArgs } from '@remix-run/node';
import { MongoClient } from 'mongodb';

// Types from your original code
type TimelineItem = {
  id: string;
  start: string;
  end: string;
};

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
    .limit(100)
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

const TimelinePage = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { items, start, end } = useLoaderData<LoaderData>();
  const fetcher = useFetcher();
  const [ iitems, setIitems ] = useState(items);
  
  const navigation = useNavigation();
  const submit = useSubmit();

  useEffect(() => {
    if (!svgRef.current || !items.length) return;

    // Setup dimensions
    const margin = { top: 20, right: 20, bottom: 60, left: 40 };
    const width = svgRef.current.clientWidth - margin.left - margin.right;
    const height = 300 - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Create scales
    const timeExtent = [new Date(start), new Date(end)];

    const xScale = d3.scaleTime()
      .domain(timeExtent)
      .range([0, width]);

    // Add clip path
    svg.append("defs")
      .append("clipPath")
      .attr("id", "clip")
      .append("rect")
      .attr("width", width)
      .attr("height", height);

    // Create container for timeline items
    const timelineGroup = svg.append("g")
      .attr("clip-path", "url(#clip)");

    // Add timeline items
    timelineGroup.selectAll(".timeline-item")
      .data(iitems)
      .enter()
      .append("rect")
      .attr("class", "timeline-item")
      .attr("x", d => xScale(new Date(d.start)))
      .attr("y", 0)
      .attr("width", d => {
        const startDate = xScale(new Date(d.start));
        const endDate = xScale(new Date(d.end));
        return Math.max(endDate - startDate, 2);
      })
      .attr("height", 10)
      .attr("fill", "#4299e1")
      .attr("opacity", 0.7);

    // Add x-axis
    const xAxis = svg.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height - margin.top})`)
      .call(d3.axisBottom(xScale));

    // Create zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.5, 20])
      .extent([[0, 0], [width, height]])
      .on("zoom", (event) => {
        const newXScale = event.transform.rescaleX(xScale);

        // Update axis
        xAxis.call(d3.axisBottom(newXScale));

        // Update timeline items
        timelineGroup.selectAll(".timeline-item")
          .attr("x", d => newXScale(new Date(d.start)))
          .attr("width", d => {
            const startDate = newXScale(new Date(d.start));
            const endDate = newXScale(new Date(d.end));
            return Math.max(endDate - startDate, 2);
          });

        // // Handle range changes with debounce
        const domain = newXScale.domain() as [Date, Date];
        handleRangeChange(domain);
      });

    d3.select(svgRef.current)
      .call(zoom as any);

    // Handle range changes with debounce
    const handleRangeChange = _.debounce((domain: [Date, Date]) => {
      const formData = new FormData();
      formData.append('start', domain[0].toISOString());
      formData.append('end', domain[1].toISOString());

        fetcher.submit(formData, {
            method: 'get',
            preventScrollReset: true,
        });
    }, 1900);
  }, [submit]);

  return (
    <div className="h-screen p-4">
      {navigation.state === "loading" && (
        <div className="absolute top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded">
          Loading...
        </div>
      )}
      <svg 
        ref={svgRef}
        className="w-full h-full border rounded-lg shadow-lg"
      />
    </div>
  );
};

export default TimelinePage;
