import { expect } from "@std/expect";
import React from "react";
import { renderToString } from "react-dom/server";
import { EventsLayer } from "@/modules/events/index.tsx";

function fakeScale(date: Date): number { return date.getTime() / 1e8; }
const fakeTransform = { applyX: (x: number) => x, rescaleX: (s: any) => s } as any;

Deno.test("EventsLayer renders svg", () => {
  const layer = EventsLayer();
  const Component = layer.component as any;
  const html = renderToString(React.createElement(Component, { scale: fakeScale as any, transform: fakeTransform, width: 800 }));
  expect(html.includes("svg")).toBe(true);
});


