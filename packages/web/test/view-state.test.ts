// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationState, SessionSummary } from "@axl/sdk";
import { editDiffRows } from "@axl/ui";
import {
  compactNumber,
  consumePendingPromptDeliveries,
  directShellInput,
  findSessionInCatalog,
  isScrolledToBottom,
  matchesSession,
  messageBlobs,
  promptDeliveryShortcut,
  restoreDraft,
  sessionStateHistory,
  sessionTitle,
  sessionUsageStats,
  transcriptMessageMatches,
  transcriptPromptBreakpoints,
  workspaceTotals,
} from "../src/view-state.ts";

const session = {
  cwd: "/workspace/مرحبا",
  firstUserMessage: "First prompt",
  lastUserMessage: "Fix 🚀 launch",
} as SessionSummary;

test("direct shell input preserves include and exclude semantics", () => {
  assert.deepEqual(directShellInput("! printf once "), {
    command: "printf once",
    excluded: false,
  });
  assert.deepEqual(directShellInput("!! git status"), {
    command: "git status",
    excluded: true,
  });
  assert.deepEqual(directShellInput("!!! literal-bang"), {
    command: "! literal-bang",
    excluded: true,
  });
  assert.equal(directShellInput("ordinary prompt"), undefined);
  assert.deepEqual(directShellInput("!"), { command: "", excluded: false });
});

test("prompt delivery uses keyboard modifiers without a mode selector", () => {
  assert.equal(
    promptDeliveryShortcut({ altKey: false, ctrlKey: false, metaKey: false }),
    undefined,
  );
  assert.equal(
    promptDeliveryShortcut({ altKey: true, ctrlKey: false, metaKey: false }),
    "follow_up",
  );
  assert.equal(
    promptDeliveryShortcut({ altKey: false, ctrlKey: true, metaKey: false }),
    "interrupt",
  );
  assert.equal(
    promptDeliveryShortcut({ altKey: false, ctrlKey: false, metaKey: true }),
    "interrupt",
  );
});

test("canonical user messages consume one matching pending delivery", () => {
  const content = [{ type: "text" as const, text: "Keep going" }];
  const pending = [
    {
      id: 1,
      mode: "steer" as const,
      text: "Keep going",
      contentKey: JSON.stringify(content),
      afterRecord: 0,
    },
    {
      id: 2,
      mode: "follow_up" as const,
      text: "Keep going",
      contentKey: JSON.stringify(content),
      afterRecord: 0,
    },
  ];
  const conversation = {
    records: [
      { kind: "event", event: { id: "delivered", type: "user.message", payload: { content } } },
    ],
  } as unknown as ConversationState;

  assert.deepEqual(consumePendingPromptDeliveries(pending, conversation), [pending[1]]);
});

test("session presentation handles fallbacks, Unicode search, and failed drafts", () => {
  assert.equal(sessionTitle(session), "Fix 🚀 launch");
  assert.equal(sessionTitle({ ...session, title: "Release work" }), "Release work");
  assert.equal(sessionTitle({} as SessionSummary), "New session");
  assert.equal(matchesSession(session, "🚀 LAUNCH"), true);
  assert.equal(matchesSession(session, "مرحبا"), true);
  assert.equal(matchesSession(session, "missing"), false);
  assert.equal(restoreDraft("failed", ""), "failed");
  assert.equal(restoreDraft("failed", "new draft"), "failed\nnew draft");
});

test("transcript navigation uses user prompts and searches messages", () => {
  const conversation = {
    compactedEventIds: ["prompt-1"],
    records: [
      {
        kind: "event",
        event: {
          id: "prompt-1",
          type: "user.message",
          payload: { content: [{ type: "text", text: "First prompt" }] },
        },
      },
      {
        kind: "event",
        event: {
          id: "answer-1",
          type: "assistant.message",
          payload: { content: [{ type: "text", text: "Useful answer" }] },
        },
      },
      {
        kind: "event",
        event: {
          id: "prompt-2",
          type: "user.message",
          payload: { content: [{ type: "blob", blob: {} }] },
        },
      },
    ],
  } as unknown as ConversationState;

  assert.deepEqual(transcriptPromptBreakpoints(conversation), [
    { id: "prompt-2", text: "Attachment" },
  ]);
  assert.deepEqual(transcriptMessageMatches(conversation, "ANSWER"), ["answer-1"]);
  assert.deepEqual(transcriptMessageMatches(conversation, "FIRST"), []);
});

test("session usage derives cache rate, throughput, and missing cost", () => {
  const conversation = {
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      reasoningTokens: 8,
      costUsd: 0.01,
    },
    records: [
      { kind: "event", event: { type: "model.request_configured", timestamp: 1000 } },
      {
        kind: "event",
        event: {
          type: "assistant.message",
          timestamp: 3000,
          payload: {
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 100,
              cacheWriteTokens: 0,
            },
          },
        },
      },
    ],
  } as unknown as ConversationState;

  assert.deepEqual(sessionUsageStats(conversation), {
    cacheHitPercent: 50,
    tokensPerSecond: 10,
    unknownCostResponses: 1,
  });
});

test("edit presentation keeps replacement order and line sides", () => {
  assert.deepEqual(editDiffRows({ edits: [{ oldText: "one\ntwo", newText: "one\nthree" }] }), [
    { kind: "meta", text: "@@ replacement 1 @@" },
    { kind: "remove", text: "one", oldLine: 1 },
    { kind: "remove", text: "two", oldLine: 2 },
    { kind: "add", text: "one", newLine: 1 },
    { kind: "add", text: "three", newLine: 2 },
  ]);
  assert.deepEqual(editDiffRows({ edits: [null, "bad"] }), []);
});

test("message blobs are collected once across user and assistant messages", () => {
  const conversation = {
    records: [
      {
        kind: "event",
        event: {
          type: "user.message",
          payload: {
            content: [
              { type: "text", text: "see this" },
              { type: "blob", blob: { sha256: "a", mediaType: "image/png" } },
            ],
          },
        },
      },
      {
        kind: "event",
        event: {
          type: "assistant.message",
          payload: { content: [{ type: "blob", blob: { sha256: "a", mediaType: "image/png" } }] },
        },
      },
      {
        kind: "event",
        event: {
          type: "assistant.message",
          payload: { content: [{ type: "blob", blob: { sha256: "b", mediaType: "image/png" } }] },
        },
      },
      { kind: "activity" },
    ],
  } as unknown as ConversationState;

  assert.deepEqual(
    messageBlobs(conversation).map((blob) => blob.sha256),
    ["a", "b"],
  );
});

test("session state history keeps the last twenty configuration events newest first", () => {
  const records = Array.from({ length: 25 }, (_value, index) => ({
    kind: "event",
    event: {
      id: `model-${index}`,
      type: "config.model",
      timestamp: index,
      payload: { modelId: `model-${index}` },
    },
  }));
  const conversation = { records } as unknown as ConversationState;
  const history = sessionStateHistory(conversation);
  assert.equal(history.length, 20);
  assert.equal(history[0]?.id, "model-24");
  assert.equal(history[0]?.label, "Model");
  assert.equal(history.at(-1)?.id, "model-5");
});

test("compact number abbreviates thousands and keeps small values exact", () => {
  assert.equal(compactNumber(999), "999");
  assert.equal(compactNumber(1000), "1.0k");
  assert.equal(compactNumber(1240), "1.2k");
  assert.equal(compactNumber(12_800), "13k");
});

test("scroll stickiness tolerates a small gap but not a scrolled-up reader", () => {
  assert.equal(isScrolledToBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(isScrolledToBottom({ scrollTop: 850, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(
    isScrolledToBottom({ scrollTop: 835, scrollHeight: 1000, clientHeight: 100 }),
    false,
  );
  assert.equal(isScrolledToBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 }), false);
  assert.equal(
    isScrolledToBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 }, 1000),
    true,
  );
});

test("catalog scan confirms deletion only after a terminal page", async () => {
  const fetchPage = (
    cursor: string | undefined,
  ): Promise<{ sessions: { sessionId: string }[]; nextPageCursor?: string }> =>
    Promise.resolve(
      cursor === "p2"
        ? { sessions: [{ sessionId: "c" }] }
        : { sessions: [{ sessionId: "a" }, { sessionId: "b" }], nextPageCursor: "p2" },
    );

  assert.deepEqual(await findSessionInCatalog(fetchPage, "c"), {
    session: { sessionId: "c" },
    confirmedAbsent: false,
  });
  assert.deepEqual(await findSessionInCatalog(fetchPage, "z"), { confirmedAbsent: true });
});

test("catalog scan leaves absence unconfirmed when the page cap is hit", async () => {
  let pageCount = 0;
  const fetchPage = (): Promise<{ sessions: { sessionId: string }[]; nextPageCursor?: string }> => {
    pageCount += 1;
    return Promise.resolve({ sessions: [{ sessionId: "other" }], nextPageCursor: "more" });
  };
  assert.deepEqual(await findSessionInCatalog(fetchPage, "missing", 3), { confirmedAbsent: false });
  assert.equal(pageCount, 3);
});

test("workspace totals combine additions and deletions across files", () => {
  assert.deepEqual(
    workspaceTotals([
      { hunks: [{ lines: [{ kind: "addition" }, { kind: "context" }] }] },
      { hunks: [{ lines: [{ kind: "deletion" }, { kind: "addition" }] }] },
    ] as never),
    { additions: 2, deletions: 1 },
  );
});
