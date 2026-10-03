// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { ActivityStorageAdapter, ActivityStorageScope, JsonValue } from "@axl/extension-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { SaveSlot, type SlotNotice } from "./save-slot.ts";

export type SlotPhase<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly slot: SaveSlot; readonly loaded: T | undefined }
  | { readonly kind: "error"; readonly message: string; readonly canReset: boolean };

export interface SlotConfig<T> {
  readonly storage: ActivityStorageAdapter;
  readonly scope: ActivityStorageScope;
  readonly schemaVersion: number;
  readonly parse: (value: JsonValue) => T;
  readonly merge?: (latest: JsonValue, mine: JsonValue) => JsonValue;
}

/** Loads one saved game and exposes the slot that writes it. Failures are returned, never hidden. */
export function useSlot<T>(config: SlotConfig<T>) {
  const configRef = useRef(config);
  configRef.current = config;
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<SlotPhase<T>>({ kind: "loading" });
  const [notice, setNotice] = useState<SlotNotice>();
  const slotRef = useRef<SaveSlot>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the load
  useEffect(() => {
    const { storage, scope, schemaVersion, merge } = configRef.current;
    const slot = new SaveSlot({
      storage,
      scope,
      schemaVersion,
      ...(merge === undefined ? {} : { merge }),
      onNotice: setNotice,
    });
    slotRef.current = slot;
    let live = true;
    setPhase({ kind: "loading" });
    setNotice(undefined);
    slot
      .load()
      .then((value) => {
        if (!live) return;
        const loaded = value === undefined ? undefined : configRef.current.parse(value);
        setPhase({ kind: "ready", slot, loaded });
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setPhase({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
          canReset: slot.revision !== null,
        });
      });
    return () => {
      live = false;
      slot.dispose();
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const reset = useCallback(async () => {
    try {
      await slotRef.current?.reset();
      setAttempt((value) => value + 1);
    } catch (cause) {
      setPhase({
        kind: "error",
        message: cause instanceof Error ? cause.message : String(cause),
        canReset: true,
      });
    }
  }, []);
  return { phase, notice, reload, reset, attempt };
}
