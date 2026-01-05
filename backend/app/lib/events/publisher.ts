import { redis } from "@/lib/redis.ts";

export async function publishEvent(
  channel: string,
  event: string,
  data: any,
): Promise<void> {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  const redisChannel = `mycelia:${channel}`;

  console.log(`Publishing to Redis: ${redisChannel}, event: ${event}`);

  const result = await redis.publish(redisChannel, message);

  console.log(`Redis publish result: ${result} subscribers received the message on ${redisChannel}`);
}

export async function publishJobUpdate(
  jobId: string,
  jobType: string,
  event: string,
  data: any,
): Promise<void> {
  const jobData = {
    jobId,
    jobType,
    ...data,
  };

  await Promise.all([
    publishEvent(`jobs:${jobId}`, event, jobData),
    publishEvent("jobs:*", event, jobData),
  ]);
}

export async function publishObjectEvent(
  event: string,
  objectId: string,
  object?: any,
): Promise<void> {
  await publishEvent("objects:*", event, {
    objectId,
    object,
  });
}

export async function publishTimelineInvalidation(
  start?: Date,
  end?: Date,
  reason?: string,
): Promise<void> {
  await publishEvent("timeline:*", "timeline.invalidated", {
    start: start?.toISOString(),
    end: end?.toISOString(),
    reason,
  });
}
