// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  type ActivityStorageAdapter,
  ActivityStorageError,
  type ActivityStorageErrorCode,
  type ActivityStoredValue,
  type JsonValue,
} from "@axl/extension-api";

export interface LoungeSettings {
  readonly lastActivityId?: string;
  readonly reducedMotion: boolean;
  readonly textOnly: boolean;
}

const STORAGE_ERROR_CODES: readonly ActivityStorageErrorCode[] = [
  "conflict",
  "invalid",
  "corrupt",
  "future-version",
  "oversized",
  "permission",
  "locked",
  "unavailable",
  "aborted",
];

export function parseLoungeSettings(value: unknown): LoungeSettings {
  const settings = value as Record<string, unknown> | null;
  if (
    typeof settings !== "object" ||
    settings === null ||
    typeof settings.reducedMotion !== "boolean" ||
    typeof settings.textOnly !== "boolean" ||
    (settings.lastActivityId !== undefined && typeof settings.lastActivityId !== "string")
  )
    throw new Error("Invalid Lounge settings");
  return {
    reducedMotion: settings.reducedMotion,
    textOnly: settings.textOnly,
    ...(settings.lastActivityId === undefined ? {} : { lastActivityId: settings.lastActivityId }),
  };
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status === 422) {
    const failure = (await response.json()) as { code?: unknown; message?: unknown };
    if (
      typeof failure.message === "string" &&
      STORAGE_ERROR_CODES.includes(failure.code as ActivityStorageErrorCode)
    )
      throw new ActivityStorageError(failure.code as ActivityStorageErrorCode, failure.message);
  }
  if (!response.ok)
    throw new Error((await response.text()) || `Lounge request failed (${response.status})`);
  return response.json();
}

export async function saveLoungeSettings(update: Partial<LoungeSettings>): Promise<LoungeSettings> {
  return parseLoungeSettings(await post("lounge/settings", { update }));
}

/** Browser view of the CLI-owned Lounge storage, so saves survive the per-launch gateway port. */
export const browserLoungeStorage: ActivityStorageAdapter = {
  async read(scope, signal) {
    const result = (await post("lounge/storage", { op: "read", scope }, signal)) as {
      value: ActivityStoredValue | null;
    };
    return result.value ?? undefined;
  },
  async write(scope, expectedRevision, schemaVersion, value: JsonValue, signal) {
    return (await post(
      "lounge/storage",
      { op: "write", scope, expectedRevision, schemaVersion, value },
      signal,
    )) as ActivityStoredValue;
  },
  async reset(scope, expectedRevision, signal) {
    await post("lounge/storage", { op: "reset", scope, expectedRevision }, signal);
  },
};
