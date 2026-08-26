import { ObjectId } from "bson";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@myceliasdk/messengers.ts";

import {
  focusDeepLinkedMessage,
  loadMessengerMessageWindow,
  messageElementId,
  mongoDeepLinkIdReference,
  normalizeMessageDeepLinkId,
} from "./messageDeepLink";

const CHAT_ID = "111111111111111111111111";
const TARGET_ID = "222222222222222222222222";

function message(id: string, timestamp: string): Message {
  return {
    _id: new ObjectId(id),
    chatId: new ObjectId(CHAT_ID),
    senderId: new ObjectId("333333333333333333333333"),
    platform: "telegram",
    externalId: id,
    text: id,
    timestamp: new Date(timestamp),
    createdAt: new Date(timestamp),
    updatedAt: new Date(timestamp),
    raw: {},
  };
}

describe("message deep links", () => {
  it("accepts ObjectId and bounded safe legacy message IDs", () => {
    expect(normalizeMessageDeepLinkId(TARGET_ID.toUpperCase())).toBe(
      TARGET_ID,
    );
    expect(normalizeMessageDeepLinkId("message/with spaces")).toBe(
      "message/with spaces",
    );
    expect(normalizeMessageDeepLinkId("bad\u0000id")).toBeUndefined();
    expect(normalizeMessageDeepLinkId("x".repeat(501))).toBeUndefined();
    expect(normalizeMessageDeepLinkId(null)).toBeUndefined();
    expect(mongoDeepLinkIdReference(TARGET_ID)).toEqual({ $oid: TARGET_ID });
    expect(mongoDeepLinkIdReference("legacy/chat 7")).toBe("legacy/chat 7");
  });

  it("focuses the exact rendered message", () => {
    const element = document.createElement("div");
    element.id = messageElementId("chat", TARGET_ID);
    element.tabIndex = -1;
    element.scrollIntoView = vi.fn();
    document.body.append(element);

    expect(focusDeepLinkedMessage("chat", TARGET_ID)).toBe(true);
    expect(element.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(document.activeElement).toBe(element);
    element.remove();
  });

  it("loads a bounded window constrained to the selected chat", async () => {
    const target = message(TARGET_ID, "2026-05-15T12:00:00Z");
    const newer = [
      message("444444444444444444444441", "2026-05-15T12:02:00Z"),
      message("444444444444444444444442", "2026-05-15T12:01:00Z"),
    ];
    const older = [
      message("555555555555555555555551", "2026-05-15T11:59:00Z"),
      message("555555555555555555555552", "2026-05-15T11:58:00Z"),
      message("555555555555555555555553", "2026-05-15T11:57:00Z"),
    ];
    const calls: Array<Record<string, unknown>> = [];
    const caller = vi.fn((_resource: string, request: Record<string, any>) => {
      calls.push(request);
      if (request.action === "findOne") return Promise.resolve(target);
      if (request.query.timestamp.$gt) return Promise.resolve(newer);
      return Promise.resolve(older);
    });

    const result = await loadMessengerMessageWindow(caller, {
      chatId: CHAT_ID,
      messageId: TARGET_ID,
      pageSize: 5,
    });

    expect(result.state).toBe("found");
    if (result.state !== "found") throw new Error("expected a found window");
    expect(result.messages).toHaveLength(5);
    expect(result.messages.map((item) => item._id.toString())).toContain(
      TARGET_ID,
    );
    expect(result.hasMoreOlder).toBe(true);
    expect(calls[0].query).toEqual({
      _id: { $oid: TARGET_ID },
      chatId: { $oid: CHAT_ID },
    });
    expect((calls[1].options as { limit: number }).limit).toBe(2);
    expect((calls[2].options as { limit: number }).limit).toBe(3);
  });

  it("queries bounded legacy string IDs with literal equality", async () => {
    const legacy = {
      ...message(TARGET_ID, "2026-05-15T12:00:00Z"),
      _id: { toString: () => "legacy/message 7" },
    } as Message;
    const calls: Array<Record<string, any>> = [];
    const caller = vi.fn((_resource: string, request: Record<string, any>) => {
      calls.push(request);
      return Promise.resolve(request.action === "findOne" ? legacy : []);
    });

    const result = await loadMessengerMessageWindow(caller, {
      chatId: "legacy/chat 3",
      messageId: "legacy/message 7",
      pageSize: 5,
    });

    expect(result.state).toBe("found");
    expect(calls[0].query._id).toBe("legacy/message 7");
    expect(calls[0].query.chatId).toBe("legacy/chat 3");
    expect(calls).toHaveLength(3);
  });

  it("returns explicit unavailable without querying malformed IDs", async () => {
    const caller = vi.fn(() => Promise.resolve(null));
    expect(
      await loadMessengerMessageWindow(caller, {
        chatId: CHAT_ID,
        messageId: "bad\u0000id",
      }),
    ).toEqual({ state: "unavailable", reason: "invalid_id" });
    expect(caller).not.toHaveBeenCalled();
  });

  it("does not fall back when the exact message is missing or belongs elsewhere", async () => {
    const caller = vi.fn(() => Promise.resolve(null));
    const result = await loadMessengerMessageWindow(caller, {
      chatId: CHAT_ID,
      messageId: TARGET_ID,
    });
    expect(result).toEqual({ state: "unavailable", reason: "not_found" });
    expect(caller).toHaveBeenCalledTimes(1);
  });
});
