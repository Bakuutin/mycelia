import { ObjectId } from "mongodb";
import _ from "lodash";
import {
  type LoaderData,
  type StartEnd,
  type Timestamp,
  zLoaderData,
  zQueryParams,
} from "../types/timeline.ts";

const day = 1000 * 60 * 60 * 24;
const year = day * 365;

export function getDaysAgo(n: number) {
  const today = new Date(new Date().toISOString().split("T")[0]);
  const monthAgo = new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
  return monthAgo;
}

export function mergeGap<T extends StartEnd>(
  items: T[],
  gap: number,
  updateKey?: (prev: T, item: T) => T,
): T[] {
  if (gap <= 0 || items.length === 0) {
    return items;
  }
  const result: T[] = [];
  let prev: T | null = null;
  for (const item of items) {
    if (prev) {
      if (prev.end.getTime() > item.start.getTime() - gap) {
        prev.end = _.max([prev.end, item.end]) as Date;
        if (updateKey) {
          prev = updateKey(prev, item);
        }
      } else {
        result.push(prev);
        prev = null;
      }
    } else {
      prev = item;
    }
  }
  if (prev) {
    result.push(prev);
  }
  return result;
}

export async function fetchTimelineData(
  db: any,
  start: Timestamp,
  end: Timestamp,
): Promise<LoaderData> {
  const startDate = new Date(Number(start));
  const endDate = new Date(Number(end));
  const duration = endDate.getTime() - startDate.getTime();
  const originalStart = startDate;
  const originalEnd = endDate;
  const queryStart = new Date(startDate.getTime() - duration / 2);
  const queryEnd = new Date(endDate.getTime() + duration / 2);

  let gap = day / 24 / 60;

  if (duration > day * 300) {
    gap = day * 7;
  } else if (duration > day * 30) {
    gap = day * 1;
  } else if (duration > day * 7) {
    gap = day / 4;
  }

  const step = gap;

  const boundaries = [];
  for (let i = queryStart; i < queryEnd; i = new Date(i.getTime() + step)) {
    boundaries.push(i);
  }

  const transcripts = (
    await db.collection("transcriptions").find({
      start: { $lte: queryEnd },
      end: { $gte: queryStart },
    }, { sort: { start: 1 }, limit: 20 })
  ).map((t: any) => {
    return {
      start: new Date(t.start.getTime() + t.segments[0].start * 1000),
      end: new Date(
        t.start.getTime() + t.segments[t.segments.length - 1].end * 1000,
      ),
      text: t.text,
      id: t._id.toHexString(),
    };
  }).sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

  return {
    voices: [],
    items: [], // TODO: restore this
    start: originalStart,
    end: originalEnd,
    gap,
    transcripts,
  };
}
