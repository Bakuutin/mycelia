import { expect } from "@std/expect";
import {
  mongoAllowedHosts,
  parseObjectTimelineDensityInput,
  schema,
} from "./objectTimelineDensityRebuild.ts";

Deno.test("object density rebuild accepts only a full-source scope", () => {
  expect(
    schema.safeParse({
      type: "objectTimelineDensityRebuild",
      windowDays: 7,
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      type: "objectTimelineDensityRebuild",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-02T00:00:00.000Z",
    }).success,
  ).toBe(false);
});

Deno.test("object density rebuild strips Mongo query options from allow-net hosts", () => {
  expect(
    mongoAllowedHosts("mongodb://mongo:27017?directConnection=true"),
  ).toEqual(["mongo:27017"]);
  expect(
    mongoAllowedHosts(
      "mongodb://user:secret@mongo-a:27017,mongo-b:27018/mycelia?replicaSet=rs0",
    ),
  ).toEqual(["mongo-a:27017", "mongo-b:27018"]);
});

Deno.test("object density rebuild accepts isolated-launcher metadata at runtime", () => {
  expect(
    parseObjectTimelineDensityInput({
      type: "objectTimelineDensityRebuild",
      windowDays: 31,
      id: "job-id",
      routingContext: {
        sourceId: "jobs",
        resolvedAt: "2026-08-17T22:00:00.000Z",
      },
    }),
  ).toEqual({ type: "objectTimelineDensityRebuild", windowDays: 31 });
});
