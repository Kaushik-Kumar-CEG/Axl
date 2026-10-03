// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import {
  type ActivityStorageAdapter,
  ActivityStorageError,
  type ActivityStorageScope,
  type JsonValue,
} from "@axl/extension-api";

export interface SlotNotice {
  readonly kind: "conflict" | "error";
  readonly message: string;
}

export interface SaveSlotOptions {
  readonly storage: ActivityStorageAdapter;
  readonly scope: ActivityStorageScope;
  readonly schemaVersion: number;
  /** Joins the newest stored value with this window's value after a conflict. */
  readonly merge?: (latest: JsonValue, mine: JsonValue) => JsonValue;
  readonly onNotice: (notice: SlotNotice | undefined) => void;
}

/** Writes for one scope run in order, even across slots, so a reopened game reads fresh data. */
const tails = new Map<string, Promise<void>>();

const aborted = (error: unknown): boolean =>
  error instanceof ActivityStorageError && error.code === "aborted";

/**
 * One saved game. Writes are serialized and compare the stored revision. After a conflict the
 * slot stops overwriting the newer save and only merges records that must not be lost.
 */
export class SaveSlot {
  readonly #options: SaveSlotOptions;
  readonly #key: string;
  readonly #loadAbort = new AbortController();
  readonly #writeSignal = new AbortController().signal;
  #revision: number | null = null;
  #blocked = false;
  #disposed = false;
  #pending: { value: JsonValue; important: boolean } | undefined;

  constructor(options: SaveSlotOptions) {
    this.#options = options;
    this.#key = `${options.scope.extensionId}/${options.scope.activityId}`;
  }

  get revision(): number | null {
    return this.#revision;
  }

  async load(): Promise<JsonValue | undefined> {
    await tails.get(this.#key);
    const { storage, scope, schemaVersion } = this.#options;
    const stored = await storage.read(scope, this.#loadAbort.signal);
    if (stored === undefined) return undefined;
    this.#revision = stored.revision;
    if (stored.schemaVersion !== schemaVersion)
      throw new ActivityStorageError(
        stored.schemaVersion > schemaVersion ? "future-version" : "corrupt",
        `Unsupported save schema ${stored.schemaVersion}`,
      );
    return stored.value;
  }

  /** Queues a write. `important` values are merged into the newest save after a conflict. */
  save(value: JsonValue, important = false): void {
    if (this.#disposed || (this.#blocked && !important)) return;
    this.#pending = { value, important: important || this.#pending?.important === true };
    const tail = (tails.get(this.#key) ?? Promise.resolve()).then(() => this.#flush());
    tails.set(this.#key, tail);
  }

  async reset(): Promise<void> {
    await tails.get(this.#key);
    if (this.#revision !== null)
      await this.#options.storage.reset(this.#options.scope, this.#revision, this.#writeSignal);
    this.#revision = null;
    this.#blocked = false;
  }

  dispose(): void {
    this.#disposed = true;
    this.#loadAbort.abort();
  }

  #notice(notice: SlotNotice | undefined): void {
    if (!this.#disposed) this.#options.onNotice(notice);
  }

  async #flush(): Promise<void> {
    const job = this.#pending;
    this.#pending = undefined;
    if (job === undefined) return;
    const { storage, scope, schemaVersion, merge } = this.#options;
    try {
      if (this.#blocked) {
        await this.#merge(job.value);
        return;
      }
      const stored = await storage.write(
        scope,
        this.#revision,
        schemaVersion,
        job.value,
        this.#writeSignal,
      );
      this.#revision = stored.revision;
    } catch (error) {
      if (aborted(error)) return;
      this.#blocked = true;
      if (error instanceof ActivityStorageError && error.code === "conflict") {
        this.#notice({
          kind: "conflict",
          message: "This save changed in another window. Your newer progress was not overwritten.",
        });
        if (job.important && merge !== undefined) {
          try {
            await this.#merge(job.value);
          } catch (cause) {
            this.#notice({
              kind: "error",
              message: cause instanceof Error ? cause.message : String(cause),
            });
          }
        }
      } else {
        this.#notice({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async #merge(mine: JsonValue): Promise<void> {
    const { storage, scope, schemaVersion, merge } = this.#options;
    if (merge === undefined) return;
    const latest = await storage.read(scope, this.#writeSignal);
    if (latest === undefined) return;
    const stored = await storage.write(
      scope,
      latest.revision,
      schemaVersion,
      merge(latest.value, mine),
      this.#writeSignal,
    );
    this.#revision = stored.revision;
  }
}
