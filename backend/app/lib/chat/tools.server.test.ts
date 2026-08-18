import { expect } from "@std/expect";
import {
  activeToolsForPolicy,
  chatToolFilter,
  normalizeChatToolPolicy,
} from "./tools.server.ts";

Deno.test("chat tool policy keeps Auto distinct from No tools", () => {
  expect(normalizeChatToolPolicy(undefined, ["search_find"])).toEqual({
    mode: "auto",
    enabledTools: [],
  });
  expect(normalizeChatToolPolicy({ mode: "none" }, ["search_find"]))
    .toEqual({ mode: "none", enabledTools: [] });
  expect(activeToolsForPolicy({ mode: "none", enabledTools: [] }, {}))
    .toEqual([]);
});

Deno.test("custom chat tools reject unavailable names", () => {
  expect(() =>
    normalizeChatToolPolicy(
      { mode: "custom", enabledTools: ["mongo_deleteOne"] },
      ["mongo_find"],
    )
  ).toThrow("Unavailable chat tools");
});

Deno.test("chat tool filter excludes writes and internal repairs", () => {
  expect(chatToolFilter("mongo_find")).toBe(true);
  expect(chatToolFilter("mongo_updateOne")).toBe(false);
  expect(chatToolFilter("objects_repairListCatalog")).toBe(false);
  expect(chatToolFilter("objects_create")).toBe(true);
});
