// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-License-Identifier: Apache-2.0

import type { ActivityStorageAdapter } from "@axl/extension-api";
import type { ReactNode } from "react";

import type { SlotNotice } from "./save-slot.ts";

export const LOUNGE_EXTENSION_ID = "axl.lounge";
export const loungeScope = (activityId: string) => ({
  extensionId: LOUNGE_EXTENSION_ID,
  activityId,
});

export interface GameProps {
  readonly storage: ActivityStorageAdapter;
  /** False when the user or the system asked for reduced motion. */
  readonly motion: boolean;
  /** Adds symbols so no state depends on color alone. */
  readonly markers: boolean;
  /** Focus the board at once. A restored game never takes focus from the composer. */
  readonly autoFocus: boolean;
}

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset className="lg-seg" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

export function GameLoading({ name }: { readonly name: string }): React.JSX.Element {
  return (
    <div className="lg-center" role="status">
      <span className="lg-spinner" aria-hidden="true" />
      <span>Loading {name}…</span>
    </div>
  );
}

export function StorageProblem({
  message,
  canReset,
  onReset,
  onRetry,
}: {
  readonly message: string;
  readonly canReset: boolean;
  readonly onReset: () => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="lg-center lg-problem" role="alert">
      <strong>This save can't be opened</strong>
      <p>{message}</p>
      <div className="lg-actions">
        <button type="button" className="lg-btn" onClick={onRetry}>
          Try again
        </button>
        {canReset && (
          <button type="button" className="lg-btn danger" onClick={onReset}>
            Erase save and start over
          </button>
        )}
      </div>
    </div>
  );
}

export function SaveNotice({
  notice,
  onReload,
}: {
  readonly notice: SlotNotice | undefined;
  readonly onReload: () => void;
}): React.JSX.Element | null {
  if (notice === undefined) return null;
  return (
    <div className={`lg-notice ${notice.kind}`} role="alert">
      <span>{notice.message}</span>
      <button type="button" onClick={onReload}>
        Load newest
      </button>
    </div>
  );
}

export function Overlay({
  title,
  children,
  actions,
  tone = "neutral",
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
  readonly tone?: "neutral" | "win" | "lose";
}): React.JSX.Element {
  return (
    <div className="lg-overlay">
      <div className={`lg-card lg-result ${tone}`} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
        <div className="lg-actions">{actions}</div>
      </div>
    </div>
  );
}

export function Toast({ text }: { readonly text: string | undefined }): React.JSX.Element {
  return (
    <div className="lg-toast-slot" aria-live="polite">
      {text !== undefined && <div className="lg-toast">{text}</div>}
    </div>
  );
}

const path = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export type IconName =
  | "close"
  | "settings"
  | "undo"
  | "hint"
  | "pencil"
  | "eraser"
  | "plus"
  | "flip"
  | "flag"
  | "shovel"
  | "menu"
  | "chart"
  | "back"
  | "next";

export function Icon({ name }: { readonly name: IconName }): React.JSX.Element {
  const body: Record<IconName, ReactNode> = {
    close: <path d="M5 5l10 10M15 5L5 15" {...path} />,
    settings: (
      <>
        <path d="M3 6h7M14 6h3M3 14h3M10 14h7" {...path} />
        <circle cx="12" cy="6" r="2" {...path} />
        <circle cx="8" cy="14" r="2" {...path} />
      </>
    ),
    undo: <path d="M7 4L3.5 7.5 7 11M3.5 7.5H12a4.5 4.5 0 010 9H8" {...path} />,
    hint: (
      <path d="M10 2.8a5 5 0 00-2.7 9.2c.5.4.7.9.7 1.5h4c0-.6.2-1.1.7-1.5A5 5 0 0010 2.8zM8 16.5h4" {...path} />
    ),
    pencil: <path d="M3.5 16.5l.8-3.4L13.6 3.8a1.7 1.7 0 012.4 2.4l-9.3 9.3zM12 5.5l2.5 2.5" {...path} />,
    eraser: <path d="M4 12.5l7-7.8a1.5 1.5 0 012.2 0l2.6 2.6a1.5 1.5 0 010 2.1L11.5 14H7.5zM7.5 14h8.5" {...path} />,
    plus: <path d="M10 4v12M4 10h12" {...path} />,
    flip: <path d="M5 7h10l-3-3M15 13H5l3 3" {...path} />,
    flag: <path d="M5 17V3.5M5 4.5h9l-2 3 2 3H5" {...path} />,
    shovel: <path d="M11 9l5-5M12.5 3.5l4 4M11 9l-4.8 4.8a1.6 1.6 0 000 2.3l.7.4a1.6 1.6 0 002.3 0L14 11" {...path} />,
    menu: <path d="M4 6h12M4 10h12M4 14h12" {...path} />,
    chart: <path d="M5 16V9M10 16V4M15 16v-5" {...path} />,
    back: <path d="M12 4l-6 6 6 6" {...path} />,
    next: <path d="M8 4l6 6-6 6" {...path} />,
  };
  return (
    <svg className="lg-icon" viewBox="0 0 20 20" aria-hidden="true">
      {body[name]}
    </svg>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  text,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly text?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="lg-tool"
      title={label}
      aria-label={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...(disabled === undefined ? {} : { disabled })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} />
      {text !== undefined && <span>{text}</span>}
    </button>
  );
}

export const clock = (ms: number): string => {
  const total = Math.floor(ms / 1_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
