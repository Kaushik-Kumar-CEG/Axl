// SPDX-FileCopyrightText: 2026 Hari Srinivasan
// SPDX-FileCopyrightText: 2026 Kaushik Kumar
// SPDX-License-Identifier: Apache-2.0

/**
 * The browser's `HTMLElement` when the consuming program includes DOM types.
 * Daemon and terminal programs compile without DOM globals.
 */
export type WebElement = typeof globalThis extends {
  readonly HTMLElement: { readonly prototype: infer Element };
}
  ? Element
  : never;

export interface WebExtension {
  readonly manifest: { readonly id: string; readonly name: string; readonly apiVersion: 1 };
  // biome-ignore lint/suspicious/noConfusingVoidType: Activation may return no disposer, including from a synchronous function.
  activate(api: WebExtensionApi): void | ExtensionDisposer | Promise<void | ExtensionDisposer>;
}

export interface WebExtensionApi {
  readonly signal: AbortSignal;
  readonly sessionId: string;
  readonly ui: {
    notify(message: string): void;
    select(title: string, choices: readonly string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    input(title: string, initial?: string): Promise<string | undefined>;
    editor(title: string, initial?: string): Promise<string | undefined>;
    /** The browser extension owns its DOM and must release listeners on abort. */
    custom<T>(
      title: string,
      render: (
        root: WebElement,
        done: (value: T | undefined) => void,
        signal: AbortSignal,
        // biome-ignore lint/suspicious/noConfusingVoidType: UI callbacks may return nothing or a disposer.
      ) => void | ExtensionDisposer,
    ): Promise<T | undefined>;
    readonly theme: {
      readonly name: "light" | "dark";
      color(role: "text" | "muted" | "accent" | "panel" | "line"): string;
    };
    setTheme(name: "light" | "dark" | "system"): void;
  };
  registerCommand(command: {
    readonly name: string;
    readonly description: string;
    run(argument: string, signal: AbortSignal): void | Promise<void>;
  }): ExtensionDisposer;
  registerStatus(id: string, label: string): ExtensionDisposer;
  registerShortcut(shortcut: {
    /** Example: Ctrl+Shift+P. Browser and Axl reserved shortcuts cannot be overridden. */
    readonly key: string;
    readonly description: string;
    run(signal: AbortSignal): void | Promise<void>;
  }): ExtensionDisposer;
  registerWidget(
    id: string,
    // biome-ignore lint/suspicious/noConfusingVoidType: Mount callbacks may return nothing or a disposer.
    widget: string | { mount(root: WebElement, signal: AbortSignal): void | ExtensionDisposer },
  ): ExtensionDisposer;
  registerToolRenderer(
    /** The model-visible tool name recorded in canonical `tool.call` events. */
    name: string,
    render: (tool: unknown) => string | undefined,
  ): ExtensionDisposer;
  registerMessageRenderer(
    source: string,
    render: (event: unknown) => string | undefined,
  ): ExtensionDisposer;
  registerEntryRenderer(
    channel: string,
    render: (event: unknown) => string | undefined,
  ): ExtensionDisposer;
  onEvent(
    handler: (event: {
      readonly type: "session.event" | "working.start" | "working.end";
      readonly event?: unknown;
      readonly signal: AbortSignal;
    }) => void | Promise<void>,
  ): ExtensionDisposer;
  registerMarkdownTransformer(
    transform: (text: string, role: "user" | "assistant") => string,
  ): ExtensionDisposer;
}

export type ExtensionCapability =
  | "terminal.commands"
  | "terminal.shortcuts"
  | "terminal.status"
  | "terminal.widgets"
  | "terminal.events"
  | "terminal.tool-renderers"
  | "terminal.ui"
  | "terminal.markdown"
  | "terminal.entries"
  | "terminal.activities"
  | "terminal.activity-storage";

export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly ExtensionCapability[];
}

export type TerminalTone = "text" | "muted" | "accent" | "success" | "warning" | "error";

export interface TerminalLine {
  readonly text: string;
  readonly tone?: TerminalTone;
}

export interface TerminalCommandContext {
  readonly signal: AbortSignal;
  notify(message: string, tone?: Exclude<TerminalTone, "text">): void;
  select(
    title: string,
    items: readonly {
      readonly value: string;
      readonly label: string;
      readonly description?: string;
    }[],
  ): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  getEditorText(): string;
  setEditorText(text: string): void;
}

export interface TerminalUi extends TerminalCommandContext {
  readonly hasUI: boolean;
  readonly mode: "tui" | "headless";
  /** Prompts resolve undefined on cancellation, replacement, or extension disposal. */
  custom<T>(
    title: string,
    create: (done: (result: T | undefined) => void) => TerminalCustomComponent,
  ): Promise<T | undefined>;
  readonly theme: TerminalTheme;
  themes(): readonly string[];
  setTheme(name: string): void;
}

export type TerminalThemeRole =
  | "dim"
  | "accent"
  | "error"
  | "bold"
  | "border"
  | "success"
  | "warning"
  | "text"
  | "userMessage"
  | "selection"
  | "searchMatch"
  | "searchCurrent"
  | "toolBackground"
  | "toolPendingBackground"
  | "toolSuccessBackground"
  | "toolErrorBackground"
  | "toolDeniedBackground"
  | "diffAdded"
  | "diffRemoved"
  | "diffContext"
  | "diffAddedBackground"
  | "diffRemovedBackground"
  | "mdHeading"
  | "mdCode"
  | "mdCodeBlockBorder"
  | "mdQuote"
  | "mdQuoteBorder"
  | "mdListBullet"
  | "syntaxComment"
  | "syntaxKeyword"
  | "syntaxFunction"
  | "syntaxVariable"
  | "syntaxString"
  | "syntaxNumber"
  | "syntaxType"
  | "syntaxOperator"
  | "syntaxPunctuation"
  | "keyword"
  | "literal";

export interface TerminalTheme {
  readonly name: string;
  /** Only roles available in the selected palette are listed. Missing roles fail explicitly. */
  roles(): readonly TerminalThemeRole[];
  style(role: TerminalThemeRole, text: string): string;
  thinking(level: string, text: string): string;
  fg(tone: TerminalTone, text: string): string;
  bold(text: string): string;
}

export interface TerminalCustomComponent {
  render(width: number): readonly TerminalLine[];
  handleKey(key: string): void;
  cursor?(): { readonly row: number; readonly column: number } | undefined;
  dispose?(): void;
}

/** Client-local main composer; the built-in editor retains the draft and safety keys. */
export interface TerminalEditorComponent {
  render(
    width: number,
    state: {
      readonly draft: string;
      readonly model: string;
      readonly working: boolean;
      readonly theme: TerminalTheme;
    },
  ): {
    readonly lines: readonly TerminalLine[];
    readonly cursor?: { readonly row: number; readonly column: number };
  };
  /** Return false to let the built-in editor handle a key. Reserved keys always stay built-in. */
  handleKey(key: string, editor: { readonly text: string; setText(text: string): void }): boolean;
  dispose?(): void | Promise<void>;
}

export interface TerminalCommand {
  readonly name: string;
  readonly description: string;
  readonly complete?: (argumentPrefix: string) => readonly string[];
  readonly run: (arguments_: string, context: TerminalCommandContext) => void | Promise<void>;
}

export interface TerminalShortcut {
  readonly key: string;
  readonly description: string;
  readonly run: (context: TerminalCommandContext) => void | Promise<void>;
}

export interface TerminalWidget {
  readonly placement?: "aboveEditor" | "belowEditor";
  /** Increment when external widget state changes. */
  readonly revision?: number;
  render(width: number): readonly TerminalLine[];
  dispose?(): void | Promise<void>;
}

export interface TerminalAutocompleteProvider {
  /** Each result replaces the prefix from `start` (default 0) to the current cursor. */
  complete(
    textBeforeCursor: string,
    signal: AbortSignal,
  ):
    | readonly { readonly value: string; readonly label?: string; readonly start?: number }[]
    | Promise<
        readonly { readonly value: string; readonly label?: string; readonly start?: number }[]
      >;
}

export type TerminalEntryRenderer = (
  value: unknown,
  width: number,
) => readonly TerminalLine[] | undefined;

export interface TerminalToolRenderInput {
  readonly callId: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: string;
  readonly isError: boolean;
  readonly status: "pending" | "running" | "succeeded" | "failed" | "denied" | "aborted";
  readonly durationMs?: number;
  readonly detail: "compact" | "full" | "focus";
}

export interface TerminalToolRenderResult {
  readonly label?: string;
  readonly target?: string;
  readonly lines?: readonly TerminalLine[];
  readonly hideWhenSuccessfulInFocus?: boolean;
}

export type TerminalToolRenderer = (
  input: TerminalToolRenderInput,
) => TerminalToolRenderResult | undefined;

export type TerminalExtensionEventInput =
  | { readonly type: "session.event"; readonly event: unknown }
  | { readonly type: "working.start" }
  | { readonly type: "working.end" }
  | {
      readonly type: "ui.prompt.start";
      readonly prompt: "select" | "confirm" | "input" | "editor" | "custom";
    }
  | {
      readonly type: "ui.prompt.end";
      readonly prompt: "select" | "confirm" | "input" | "editor" | "custom";
    };

export type TerminalExtensionEvent<
  Type extends TerminalExtensionEventInput["type"] = TerminalExtensionEventInput["type"],
> = Extract<TerminalExtensionEventInput, { readonly type: Type }> & {
  readonly signal: AbortSignal;
};

export type ExtensionDisposer = () => void | Promise<void>;

/**
 * Daemon extension contracts. A daemon extension is a module in
 * `~/.axl/extensions/` whose default export is a `DaemonExtensionFactory`. It
 * runs inside the daemon process with the daemon's permissions and may add
 * model-discoverable tools, block tool calls, and observe canonical events.
 */
export type DaemonJsonObject = Readonly<Record<string, unknown>>;

export interface DaemonToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
}

export interface DaemonToolDefinition {
  /** Canonical tool name: `^[a-z][a-z0-9_]*$`. Must not shadow a built-in tool. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool input object. */
  readonly inputSchema: DaemonJsonObject;
  execute(
    input: DaemonJsonObject,
    signal: AbortSignal,
    context: { readonly reportProgress: (progress: unknown) => void },
  ): DaemonToolResult | Promise<DaemonToolResult>;
}

export interface DaemonToolCallEvent {
  readonly callId: string;
  readonly name: string;
  readonly input: DaemonJsonObject;
  readonly signal: AbortSignal;
}

/** Return a block or replacement input. Any thrown error also blocks the call. */
export type DaemonToolCallDecision =
  | { readonly block: true; readonly reason: string }
  | { readonly input: DaemonJsonObject }
  | undefined;

export interface DaemonToolResultEvent {
  readonly callId: string;
  readonly name: string;
  readonly input: DaemonJsonObject;
  readonly content: readonly (
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "blob"; readonly blob: DaemonJsonObject }
  )[];
  readonly isError: boolean;
  readonly details?: unknown;
  readonly signal: AbortSignal;
}

export interface DaemonToolResultDecision {
  readonly content?: DaemonToolResultEvent["content"];
  readonly isError?: boolean;
  readonly details?: unknown;
}

export interface DaemonSessionEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number;
  readonly payload: unknown;
  /** Aborted when the owning extension begins disposal. */
  readonly signal: AbortSignal;
}

export type DaemonCommandSource = "client" | "model" | "automatic";

/**
 * A built-in daemon command about to run. `name` is the built-in command name
 * (`compact`, `reload`, `model`, `thinking`, `request`, `fork`, `clone`,
 * `rename`). `args` are the command's inputs; the daemon documents each shape.
 */
export interface DaemonCommandEvent {
  readonly name: string;
  readonly source: DaemonCommandSource;
  readonly args: DaemonJsonObject;
  readonly signal: AbortSignal;
}

/**
 * Return nothing to run the built-in unchanged, `{ args }` to run it with
 * replaced inputs, or `{ block: true, reason }` to refuse it. A thrown error
 * also refuses it.
 */
export type DaemonCommandDecision =
  | { readonly args: DaemonJsonObject }
  | { readonly block: true; readonly reason: string }
  | undefined;

export type DaemonCommandHandler = (
  event: DaemonCommandEvent,
) => DaemonCommandDecision | Promise<DaemonCommandDecision>;

export type DaemonInterceptionEventName =
  | "project_trust"
  | "session_before_fork"
  | "session_before_compact"
  | "user_bash";

export type DaemonToolCallHandler = (
  event: DaemonToolCallEvent,
) => DaemonToolCallDecision | Promise<DaemonToolCallDecision>;

export type DaemonToolResultHandler = (
  event: DaemonToolResultEvent,
) => DaemonToolResultDecision | undefined | Promise<DaemonToolResultDecision | undefined>;

export type DaemonSessionEventHandler = (event: DaemonSessionEvent) => void | Promise<void>;

export type DaemonLifecycleEventName =
  | "session_start"
  | "session_info_changed"
  | "session_compact"
  | "session_compact_failed"
  | "session_shutdown"
  | "agent_start"
  | "agent_end"
  | "agent_settled"
  | "turn_start"
  | "turn_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "model_select"
  | "thinking_level_select"
  | "extension_event";

export interface DaemonLifecycleEvent {
  readonly type: DaemonLifecycleEventName;
  readonly payload: unknown;
  readonly signal: AbortSignal;
}

export type DaemonLifecycleEventHandler = (event: DaemonLifecycleEvent) => void | Promise<void>;

export interface DaemonContextResource {
  readonly name: string;
  readonly content: string;
}

export type DaemonResourceDiscoveryHandler = (event: {
  readonly cwd: string;
  readonly signal: AbortSignal;
}) => readonly DaemonContextResource[] | Promise<readonly DaemonContextResource[]>;

export interface DaemonContextContribution {
  readonly source: string;
  readonly content: string;
  readonly target?: "message" | "system";
}

export type DaemonContextHandler = (event: {
  readonly systemPrompt: string;
  readonly messages: readonly unknown[];
  readonly signal: AbortSignal;
}) => readonly DaemonContextContribution[] | Promise<readonly DaemonContextContribution[]>;

export interface DaemonProviderHeadersEvent {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type DaemonProviderHeadersHandler = (
  event: DaemonProviderHeadersEvent,
) =>
  | Readonly<Record<string, string>>
  | undefined
  | Promise<Readonly<Record<string, string>> | undefined>;

export interface DaemonProviderRequestEvent {
  readonly url: string;
  readonly payload: unknown;
  readonly signal: AbortSignal;
}

export type DaemonProviderRequestHandler = (
  event: DaemonProviderRequestEvent,
) => unknown | Promise<unknown>;

export interface DaemonProviderResponseEvent {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type DaemonProviderResponseHandler = (
  event: DaemonProviderResponseEvent,
) => void | Promise<void>;

export interface DaemonInputEvent {
  readonly source: "client" | "extension";
  readonly content: readonly unknown[];
  readonly signal: AbortSignal;
}

export type DaemonInputDecision =
  | { readonly action: "transform"; readonly content: readonly unknown[] }
  | { readonly action: "handled" }
  | undefined;

export type DaemonInputHandler = (
  event: DaemonInputEvent,
) => DaemonInputDecision | Promise<DaemonInputDecision>;

export interface DaemonCommandDefinition {
  readonly name: string;
  readonly description: string;
  execute(
    args: DaemonJsonObject,
    context: { readonly signal: AbortSignal },
  ): undefined | string | Promise<undefined | string>;
}

export interface DaemonExtensionSession {
  send(content: readonly unknown[], delivery: "steer" | "follow_up"): Promise<void>;
  sendExtensionMessage(source: string, content: string): Promise<void>;
  compact(instructions?: string): Promise<unknown>;
  reload(): Promise<unknown>;
  abort(): Promise<boolean>;
  shutdown(): Promise<void>;
  rename(title: string): Promise<unknown>;
  setModel(providerId: string, modelId: string): Promise<unknown>;
  setThinkingLevel(
    level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
  ): Promise<unknown>;
  activateTools(identities: readonly string[]): Promise<readonly string[]>;
  newSession(cwd?: string): Promise<{ readonly sessionId: string }>;
  fork(fromEventId: string): Promise<{ readonly sessionId: string }>;
  clone(): Promise<{ readonly sessionId: string }>;
  extensions(): Promise<{
    readonly extensions: readonly {
      readonly id: string;
      readonly source: "builtin" | "global" | "explicit" | "project" | "package";
      readonly enabled: boolean;
      readonly error?: string;
    }[];
  }>;
  info(): Promise<{
    readonly sessionId: string;
    readonly cwd: string;
    readonly name?: string;
    readonly modelId?: string;
    readonly thinkingLevel?: string;
    readonly models: readonly { readonly providerId: string; readonly modelId: string }[];
    readonly projectTrusted: boolean;
    readonly activeTools: readonly string[];
    readonly systemPrompt?: string;
    readonly contextTokens?: number;
    readonly idle: boolean;
    readonly pending: { readonly steering: number; readonly followUp: number };
  }>;
  getEntryLabel(eventId: string): Promise<string | undefined>;
  setEntryLabel(eventId: string, label?: string): Promise<void>;
}

export interface DaemonExtensionState {
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DaemonExtensionApi {
  /** Stable identity derived from the extension file name. */
  readonly extensionId: string;
  readonly mode: "daemon";
  readonly uiAvailable: false;
  /** Session working directory. */
  readonly cwd: string;
  /** Aborted when activation is cancelled or this extension begins disposal. */
  readonly signal: AbortSignal;
  /** Namespaced canonical state reconstructed from the session log. */
  readonly state: DaemonExtensionState;
  /** Publishes a namespaced canonical event to daemon and presentation extensions. */
  emit(channel: string, payload: unknown): Promise<void>;
  /** Scoped daemon-owned session operations. */
  readonly session: DaemonExtensionSession;
  /** Adds a tool the model can discover through `capability_search` and activate for the session. */
  registerTool(definition: DaemonToolDefinition): ExtensionDisposer;
  /** Adds a daemon-owned command callable through the public SDK. */
  registerCommand(definition: DaemonCommandDefinition): ExtensionDisposer;
  /** Registers an existing Axl ModelProvider implementation at daemon scope. */
  registerProvider(provider: object): ExtensionDisposer;
  on(event: "tool.call", handler: DaemonToolCallHandler): ExtensionDisposer;
  on(event: "tool.result", handler: DaemonToolResultHandler): ExtensionDisposer;
  /** Intercepts every built-in command before the daemon runs it. */
  on(event: "command", handler: DaemonCommandHandler): ExtensionDisposer;
  on(event: DaemonInterceptionEventName, handler: DaemonCommandHandler): ExtensionDisposer;
  on(event: "session.event", handler: DaemonSessionEventHandler): ExtensionDisposer;
  on(event: DaemonLifecycleEventName, handler: DaemonLifecycleEventHandler): ExtensionDisposer;
  on(event: "resources_discover", handler: DaemonResourceDiscoveryHandler): ExtensionDisposer;
  on(event: "before_agent_start" | "context", handler: DaemonContextHandler): ExtensionDisposer;
  on(event: "input", handler: DaemonInputHandler): ExtensionDisposer;
  on(event: "before_provider_headers", handler: DaemonProviderHeadersHandler): ExtensionDisposer;
  on(event: "before_provider_request", handler: DaemonProviderRequestHandler): ExtensionDisposer;
  on(event: "after_provider_response", handler: DaemonProviderResponseHandler): ExtensionDisposer;
  /** Registers cleanup that runs when the session ends. */
  track(disposer: ExtensionDisposer): ExtensionDisposer;
}

export type DaemonExtensionFactory = (api: DaemonExtensionApi) => void | Promise<void>;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ActivityStyle =
  | "text"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "selection";

export interface ActivitySpan {
  readonly text: string;
  readonly style: ActivityStyle;
  readonly emphasis?: "none" | "strong" | "reverse";
}

export interface ActivityRasterColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface ActivityRasterImage {
  readonly format: "indexed";
  readonly width: number;
  readonly height: number;
  readonly palette: readonly ActivityRasterColor[];
  readonly pixels: Uint8Array;
  /** Cell region reserved by frame lines and replaced by the image when supported. */
  readonly placement: {
    readonly row: number;
    readonly column: number;
    readonly columns: number;
    readonly rows: number;
  };
  readonly description: string;
}

export interface ActivityFrame {
  readonly lines: readonly (readonly ActivitySpan[])[];
  readonly images?: readonly ActivityRasterImage[];
  readonly cursor?: { readonly row: number; readonly column: number };
  readonly announcement?: string;
}

export interface ActivityViewport {
  readonly width: number;
  readonly height: number;
}

export interface ActivityPresentationPreferences {
  readonly reducedMotion: boolean;
  readonly textOnly: boolean;
}

export interface ActivitySafeStatus {
  readonly operation:
    | "idle"
    | "working"
    | "waiting"
    | "blocked"
    | "failed"
    | "completed"
    | "unknown";
  readonly elapsedMs?: number;
  readonly activeToolCount: number;
  readonly queuedInput: {
    readonly steer: number;
    readonly followUp: number;
    readonly interrupt: number;
  };
}

export type ActivityInput =
  | {
      readonly type: "key";
      readonly key: string;
      readonly ctrl: boolean;
      readonly alt: boolean;
      readonly shift: boolean;
      readonly repeat: boolean;
    }
  | { readonly type: "paste" }
  | { readonly type: "composition" }
  | {
      readonly type: "mouse";
      readonly phase: "press" | "release";
      readonly button: "left" | "middle" | "right";
      readonly row: number;
      readonly column: number;
      readonly ctrl: boolean;
      readonly alt: boolean;
      readonly shift: boolean;
    }
  | { readonly type: "focus"; readonly focused: boolean }
  | { readonly type: "unknown" };

export type ActivityPauseReason =
  | "attention"
  | "hidden"
  | "unfocused"
  | "monitor-focused"
  | "unsupported-size"
  | "disconnect"
  | "completion"
  | "failure"
  | "session-switch"
  | "reload";

export interface ActivityStoredValue<T extends JsonValue = JsonValue> {
  readonly revision: number;
  readonly schemaVersion: number;
  readonly value: T;
}

export interface ActivityStorage<T extends JsonValue = JsonValue> {
  read(signal?: AbortSignal): Promise<ActivityStoredValue<T> | undefined>;
  write(
    expectedRevision: number | null,
    schemaVersion: number,
    value: T,
    signal?: AbortSignal,
  ): Promise<ActivityStoredValue<T>>;
  reset(expectedRevision: number, signal?: AbortSignal): Promise<void>;
}

export interface ActivityStorageScope {
  readonly extensionId: string;
  readonly activityId: string;
}

export interface ActivityStorageAdapter {
  read(scope: ActivityStorageScope, signal: AbortSignal): Promise<ActivityStoredValue | undefined>;
  write(
    scope: ActivityStorageScope,
    expectedRevision: number | null,
    schemaVersion: number,
    value: JsonValue,
    signal: AbortSignal,
  ): Promise<ActivityStoredValue>;
  reset(scope: ActivityStorageScope, expectedRevision: number, signal: AbortSignal): Promise<void>;
}

export type ActivityScheduledCallback = (elapsedMs: number) => void;

export interface ActivityContext {
  readonly signal: AbortSignal;
  now(): number;
  status(): ActivitySafeStatus;
  presentation(): ActivityPresentationPreferences;
  invalidate(): void;
  schedule(delayMs: number, callback: ActivityScheduledCallback): ExtensionDisposer;
  readonly storage?: ActivityStorage;
}

export interface TerminalActivityInstance {
  render(viewport: ActivityViewport): ActivityFrame;
  handleInput(input: ActivityInput): void;
  presentationChanged?(): void;
  pause(reason: ActivityPauseReason): void;
  resume(): void;
  serialize(): JsonValue | undefined;
  dispose(): void | Promise<void>;
}

export interface TerminalActivity {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "game";
  readonly mouse?: boolean;
  readonly minimumViewport?: ActivityViewport;
  create(context: ActivityContext): TerminalActivityInstance;
}

export interface OwnedTerminalActivity extends TerminalActivity {
  readonly extensionId: string;
}

export interface ActivityHostServices {
  now(): number;
  schedule(delayMs: number, callback: () => void): ExtensionDisposer;
  invalidate(): void;
  status(): ActivitySafeStatus;
  presentation(): ActivityPresentationPreferences;
  readonly storage?: ActivityStorageAdapter;
}

export interface HostedActivityInstance {
  readonly extensionId: string;
  readonly activityId: string;
  readonly epoch: number;
  readonly state: "active" | "paused" | "disposed";
  render(epoch: number, viewport: ActivityViewport): ActivityFrame;
  handleInput(epoch: number, input: ActivityInput): void;
  presentationChanged(epoch: number): void;
  pause(epoch: number, reason: ActivityPauseReason): void;
  resume(epoch: number): void;
  serialize(epoch: number): JsonValue | undefined;
  dispose(): Promise<void>;
}

export const ACTIVITY_LIMITS = Object.freeze({
  maxFrameLines: 512,
  maxSpans: 4_096,
  maxFrameBytes: 256 * 1024,
  maxRasterImages: 4,
  maxRasterWidth: 512,
  maxRasterHeight: 512,
  maxRasterPixels: 512 * 512,
  maxRasterPaletteColors: 16,
  maxRasterDescriptionBytes: 256,
  maxAnnouncementBytes: 4 * 1024,
  maxStoredBytes: 256 * 1024,
  maxViewportWidth: 1_000,
  maxViewportHeight: 1_000,
  maxScheduleDelayMs: 24 * 60 * 60 * 1_000,
});

export class ActivityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityContractError";
  }
}

export type ActivityStorageErrorCode =
  | "conflict"
  | "invalid"
  | "corrupt"
  | "future-version"
  | "oversized"
  | "permission"
  | "locked"
  | "unavailable"
  | "aborted";

export class ActivityStorageError extends Error {
  readonly code: ActivityStorageErrorCode;

  constructor(code: ActivityStorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ActivityStorageError";
    this.code = code;
  }
}

export interface TerminalExtensionApi {
  readonly ui: TerminalUi;
  registerCommand(command: TerminalCommand): ExtensionDisposer;
  registerShortcut(shortcut: TerminalShortcut): ExtensionDisposer;
  registerStatus(key: string, text: TerminalLine): ExtensionDisposer;
  registerWorkingLabel(label: string): ExtensionDisposer;
  registerWidget(key: string, widget: TerminalWidget): ExtensionDisposer;
  registerToolRenderer(toolName: string, renderer: TerminalToolRenderer): ExtensionDisposer;
  registerActivity(activity: TerminalActivity): ExtensionDisposer;
  registerHeader(key: string, widget: TerminalWidget): ExtensionDisposer;
  registerFooter(key: string, widget: TerminalWidget): ExtensionDisposer;
  registerMarkdownTransformer(
    transform: (markdown: string, source: "user" | "assistant") => string,
  ): ExtensionDisposer;
  registerMessageRenderer(channel: string, renderer: TerminalEntryRenderer): ExtensionDisposer;
  registerEntryRenderer(channel: string, renderer: TerminalEntryRenderer): ExtensionDisposer;
  registerAutocompleteProvider(provider: TerminalAutocompleteProvider): ExtensionDisposer;
  registerEditor(component: TerminalEditorComponent): ExtensionDisposer;
  on<Type extends TerminalExtensionEventInput["type"]>(
    event: Type,
    handler: (event: TerminalExtensionEvent<Type>) => void | Promise<void>,
  ): ExtensionDisposer;
  track(disposer: ExtensionDisposer): ExtensionDisposer;
}

export interface TerminalExtension {
  readonly manifest: ExtensionManifest;
  activate(
    api: TerminalExtensionApi,
  ): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}

export interface OwnedTerminalCommand extends TerminalCommand {
  readonly extensionId: string;
}

export interface OwnedTerminalShortcut extends TerminalShortcut {
  readonly extensionId: string;
}

export interface OwnedTerminalToolRenderer {
  readonly extensionId: string;
  readonly renderer: TerminalToolRenderer;
}

interface OwnedStatus {
  readonly extensionId: string;
  readonly line: TerminalLine;
}

interface OwnedWidget {
  readonly extensionId: string;
  readonly widget: TerminalWidget;
}

interface OwnedListener {
  readonly extensionId: string;
  readonly handler: (event: TerminalExtensionEvent) => void | Promise<void>;
}

export interface TerminalExtensionHostOptions {
  readonly cleanupTimeoutMs?: number;
  readonly uiFor?: (signal: AbortSignal) => TerminalUi;
  /** Definitions kept available for explicit later activation without running them initially. */
  readonly initiallyInactiveExtensionIds?: readonly string[];
}

interface OwnedDisposer {
  readonly extensionId: string;
  readonly dispose: ExtensionDisposer;
}

const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;
const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const COMMAND_NAME = /^[a-z][a-z0-9-]*$/;
const ENTRY_CHANNEL = /^[a-z][a-z0-9_.-]{0,127}$/;
const TERMINAL_CAPABILITIES = new Set<ExtensionCapability>([
  "terminal.commands",
  "terminal.shortcuts",
  "terminal.status",
  "terminal.widgets",
  "terminal.events",
  "terminal.tool-renderers",
  "terminal.ui",
  "terminal.markdown",
  "terminal.entries",
  "terminal.activities",
  "terminal.activity-storage",
]);
const TERMINAL_EVENTS = new Set<TerminalExtensionEventInput["type"]>([
  "session.event",
  "working.start",
  "working.end",
  "ui.prompt.start",
  "ui.prompt.end",
]);

export class ExtensionRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionRegistrationError";
  }
}

function headlessUi(signal: AbortSignal): TerminalUi {
  const unavailable = (): never => {
    throw new ExtensionRegistrationError("Terminal UI is unavailable in this host");
  };
  return {
    signal,
    hasUI: false,
    mode: "headless",
    notify: unavailable,
    select: unavailable,
    confirm: unavailable,
    input: unavailable,
    editor: unavailable,
    custom: unavailable,
    getEditorText: unavailable,
    setEditorText: unavailable,
    get theme(): TerminalTheme {
      return unavailable();
    },
    themes: unavailable,
    setTheme: unavailable,
  };
}

function once(dispose: ExtensionDisposer): ExtensionDisposer {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    return dispose();
  };
}

async function withinCleanupBudget(
  tasks: readonly Promise<void>[],
  milliseconds: number,
): Promise<void> {
  if (tasks.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Extension cleanup exceeded ${milliseconds}ms`)),
      milliseconds,
    );
  });
  try {
    await Promise.race([Promise.all(tasks), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertBoundedText(value: string, label: string, maximumBytes: number): void {
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    throw new ActivityContractError(`${label} exceeds ${maximumBytes} bytes`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ActivityContractError(`${label} must be a positive integer`);
  }
}

function validateJson(value: unknown, maximumBytes = ACTIVITY_LIMITS.maxStoredBytes): JsonValue {
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") {
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate))
        throw new ActivityStorageError("invalid", "JSON numbers must be finite");
      return;
    }
    if (typeof candidate !== "object") {
      throw new ActivityStorageError("invalid", "Activity state must contain only JSON values");
    }
    if (seen.has(candidate))
      throw new ActivityStorageError("invalid", "Activity state must not be cyclic");
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        if (!(index in candidate))
          throw new ActivityStorageError("invalid", "Activity state arrays must not be sparse");
        visit(candidate[index]);
      }
    } else {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ActivityStorageError("invalid", "Activity state objects must be plain objects");
      }
      for (const item of Object.values(candidate)) visit(item);
    }
    seen.delete(candidate);
  };
  visit(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new ActivityStorageError(
      "invalid",
      `Activity state is not serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new ActivityStorageError("oversized", `Activity state exceeds ${maximumBytes} bytes`);
  }
  return value as JsonValue;
}

function validateStoredValue(value: ActivityStoredValue): ActivityStoredValue {
  assertPositiveInteger(value.revision, "storage revision");
  assertPositiveInteger(value.schemaVersion, "storage schemaVersion");
  validateJson(value.value);
  return value;
}

function validateStatus(status: ActivitySafeStatus): ActivitySafeStatus {
  const operations = new Set<ActivitySafeStatus["operation"]>([
    "idle",
    "working",
    "waiting",
    "blocked",
    "failed",
    "completed",
    "unknown",
  ]);
  if (!operations.has(status.operation))
    throw new ActivityContractError("Invalid activity operation status");
  for (const [label, value] of [
    ["activeToolCount", status.activeToolCount],
    ["queuedInput.steer", status.queuedInput.steer],
    ["queuedInput.followUp", status.queuedInput.followUp],
    ["queuedInput.interrupt", status.queuedInput.interrupt],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ActivityContractError(`${label} must be a non-negative integer`);
    }
  }
  if (
    status.elapsedMs !== undefined &&
    (!Number.isFinite(status.elapsedMs) || status.elapsedMs < 0)
  ) {
    throw new ActivityContractError("elapsedMs must be finite and non-negative");
  }
  return Object.freeze({
    operation: status.operation,
    ...(status.elapsedMs === undefined ? {} : { elapsedMs: status.elapsedMs }),
    activeToolCount: status.activeToolCount,
    queuedInput: Object.freeze({ ...status.queuedInput }),
  });
}

function validatePresentation(
  preferences: ActivityPresentationPreferences,
): ActivityPresentationPreferences {
  if (typeof preferences.reducedMotion !== "boolean" || typeof preferences.textOnly !== "boolean") {
    throw new ActivityContractError("Activity presentation preferences must be boolean");
  }
  return Object.freeze({ ...preferences });
}

function validateViewport(viewport: ActivityViewport): void {
  assertPositiveInteger(viewport.width, "viewport width");
  assertPositiveInteger(viewport.height, "viewport height");
  if (
    viewport.width > ACTIVITY_LIMITS.maxViewportWidth ||
    viewport.height > ACTIVITY_LIMITS.maxViewportHeight
  ) {
    throw new ActivityContractError("Activity viewport exceeds host bounds");
  }
}

function validateFrame(frame: ActivityFrame, viewport: ActivityViewport): ActivityFrame {
  if (!Array.isArray(frame.lines))
    throw new ActivityContractError("Activity frame lines must be an array");
  if (frame.lines.length > viewport.height || frame.lines.length > ACTIVITY_LIMITS.maxFrameLines) {
    throw new ActivityContractError("Activity frame exceeds the line bound");
  }
  let spans = 0;
  let bytes = 0;
  const encoder = new TextEncoder();
  const styles = new Set<ActivityStyle>([
    "text",
    "muted",
    "accent",
    "success",
    "warning",
    "error",
    "selection",
  ]);
  for (const line of frame.lines) {
    if (!Array.isArray(line))
      throw new ActivityContractError("Activity frame lines must contain span arrays");
    spans += line.length;
    for (const span of line) {
      if (typeof span.text !== "string" || !styles.has(span.style)) {
        throw new ActivityContractError("Activity frame contains an invalid span");
      }
      if (span.emphasis !== undefined && !["none", "strong", "reverse"].includes(span.emphasis)) {
        throw new ActivityContractError("Activity frame contains invalid emphasis");
      }
      bytes += encoder.encode(span.text).byteLength;
    }
  }
  if (spans > ACTIVITY_LIMITS.maxSpans)
    throw new ActivityContractError("Activity frame exceeds the span bound");
  if (bytes > ACTIVITY_LIMITS.maxFrameBytes)
    throw new ActivityContractError("Activity frame exceeds the text bound");
  const validatedImages: ActivityRasterImage[] = [];
  if (frame.images !== undefined) {
    if (!Array.isArray(frame.images))
      throw new ActivityContractError("Activity frame images must be an array");
    if (frame.images.length > ACTIVITY_LIMITS.maxRasterImages)
      throw new ActivityContractError("Activity frame exceeds the image bound");
    let rasterPixels = 0;
    for (const image of frame.images) {
      if (image === null || typeof image !== "object" || image.format !== "indexed")
        throw new ActivityContractError("Activity frame contains an invalid image");
      if (
        !Number.isSafeInteger(image.width) ||
        !Number.isSafeInteger(image.height) ||
        image.width <= 0 ||
        image.height <= 0 ||
        image.width > ACTIVITY_LIMITS.maxRasterWidth ||
        image.height > ACTIVITY_LIMITS.maxRasterHeight
      ) {
        throw new ActivityContractError("Activity image dimensions are outside host bounds");
      }
      const pixelCount = image.width * image.height;
      rasterPixels += pixelCount;
      if (
        !(image.pixels instanceof Uint8Array) ||
        image.pixels.byteLength !== pixelCount ||
        rasterPixels > ACTIVITY_LIMITS.maxRasterPixels
      ) {
        throw new ActivityContractError("Activity image pixels are invalid or oversized");
      }
      if (
        !Array.isArray(image.palette) ||
        image.palette.length === 0 ||
        image.palette.length > ACTIVITY_LIMITS.maxRasterPaletteColors
      ) {
        throw new ActivityContractError("Activity image palette is invalid or oversized");
      }
      for (const color of image.palette) {
        if (
          color === null ||
          typeof color !== "object" ||
          ![color.red, color.green, color.blue].every(
            (channel) => Number.isSafeInteger(channel) && channel >= 0 && channel <= 255,
          )
        ) {
          throw new ActivityContractError("Activity image palette contains an invalid color");
        }
      }
      for (const pixel of image.pixels) {
        if (pixel >= image.palette.length)
          throw new ActivityContractError("Activity image contains an invalid palette index");
      }
      const placement = image.placement;
      if (
        placement === null ||
        typeof placement !== "object" ||
        ![placement.row, placement.column].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        ![placement.columns, placement.rows].every(
          (value) => Number.isSafeInteger(value) && value > 0,
        ) ||
        placement.row + placement.rows > frame.lines.length ||
        placement.row + placement.rows > viewport.height ||
        placement.column + placement.columns > viewport.width
      ) {
        throw new ActivityContractError("Activity image placement is outside its reserved frame");
      }
      if (typeof image.description !== "string")
        throw new ActivityContractError("Activity image description must be text");
      assertBoundedText(
        image.description,
        "Activity image description",
        ACTIVITY_LIMITS.maxRasterDescriptionBytes,
      );
      validatedImages.push(
        Object.freeze({
          format: image.format,
          width: image.width,
          height: image.height,
          palette: Object.freeze(
            image.palette.map((color: ActivityRasterColor) => Object.freeze({ ...color })),
          ),
          pixels: image.pixels.slice(),
          placement: Object.freeze({ ...image.placement }),
          description: image.description,
        }),
      );
    }
  }
  if (frame.announcement !== undefined) {
    assertBoundedText(
      frame.announcement,
      "Activity announcement",
      ACTIVITY_LIMITS.maxAnnouncementBytes,
    );
  }
  if (frame.cursor !== undefined) {
    if (
      !Number.isSafeInteger(frame.cursor.row) ||
      !Number.isSafeInteger(frame.cursor.column) ||
      frame.cursor.row < 0 ||
      frame.cursor.column < 0 ||
      frame.cursor.row >= viewport.height ||
      frame.cursor.column >= viewport.width
    ) {
      throw new ActivityContractError("Activity cursor is outside the viewport");
    }
  }
  return frame.images === undefined
    ? frame
    : Object.freeze({ ...frame, images: Object.freeze(validatedImages) });
}

function validateInput(input: ActivityInput): void {
  if (input.type === "key") {
    if (typeof input.key !== "string" || input.key.length === 0 || input.key.length > 64) {
      throw new ActivityContractError("Activity key identifier is invalid");
    }
    for (const modifier of [input.ctrl, input.alt, input.shift, input.repeat]) {
      if (typeof modifier !== "boolean")
        throw new ActivityContractError("Activity key modifiers must be boolean");
    }
  } else if (input.type === "mouse") {
    if (input.phase !== "press" && input.phase !== "release") {
      throw new ActivityContractError("Activity mouse phase is invalid");
    }
    if (input.button !== "left" && input.button !== "middle" && input.button !== "right") {
      throw new ActivityContractError("Activity mouse button is invalid");
    }
    if (
      !Number.isSafeInteger(input.row) ||
      !Number.isSafeInteger(input.column) ||
      input.row < 0 ||
      input.column < 0 ||
      input.row >= ACTIVITY_LIMITS.maxViewportHeight ||
      input.column >= ACTIVITY_LIMITS.maxViewportWidth
    ) {
      throw new ActivityContractError("Activity mouse position is outside host bounds");
    }
    for (const modifier of [input.ctrl, input.alt, input.shift]) {
      if (typeof modifier !== "boolean") {
        throw new ActivityContractError("Activity mouse modifiers must be boolean");
      }
    }
  } else if (input.type === "focus") {
    if (typeof input.focused !== "boolean")
      throw new ActivityContractError("Activity focus must be boolean");
  } else if (!["paste", "composition", "unknown"].includes(input.type)) {
    throw new ActivityContractError("Unknown structured activity input");
  }
}

class HostedActivity implements HostedActivityInstance {
  readonly extensionId: string;
  readonly activityId: string;
  private readonly services: ActivityHostServices;
  private readonly mouseEnabled: boolean;
  private readonly onDisposed: () => void;
  private epochValue = 1;
  private stateValue: "active" | "paused" | "disposed" = "active";
  private readonly lifecycle = new AbortController();
  private epochLifecycle = new AbortController();
  private readonly schedules = new Set<ExtensionDisposer>();
  private invalidationPending = false;
  private lastNow = 0;
  private viewport: ActivityViewport | undefined;
  private instance: TerminalActivityInstance | undefined;
  private disposal: Promise<void> | undefined;

  constructor(
    extensionId: string,
    activityId: string,
    services: ActivityHostServices,
    create: (context: ActivityContext) => TerminalActivityInstance,
    storageEnabled: boolean,
    mouseEnabled: boolean,
    onDisposed: () => void,
  ) {
    this.extensionId = extensionId;
    this.activityId = activityId;
    this.services = services;
    this.mouseEnabled = mouseEnabled;
    this.onDisposed = onDisposed;
    this.lastNow = this.readNow();
    const thisHost = this;
    const context: ActivityContext = {
      get signal() {
        return thisHost.epochLifecycle.signal;
      },
      now: () => {
        this.assertActive();
        return this.readNow();
      },
      status: () => {
        this.assertActive();
        return validateStatus(this.services.status());
      },
      presentation: () => {
        this.assertActive();
        return validatePresentation(this.services.presentation());
      },
      invalidate: () => {
        this.assertActive();
        if (this.invalidationPending) return;
        this.invalidationPending = true;
        this.services.invalidate();
      },
      schedule: (delayMs, callback) => this.schedule(delayMs, callback),
      ...(storageEnabled ? { storage: this.createStorage() } : {}),
    };
    try {
      this.instance = create(Object.freeze(context));
      if (this.instance === null || typeof this.instance !== "object") {
        throw new ActivityContractError(`Activity ${activityId} did not create an instance`);
      }
    } catch (error) {
      this.stateValue = "disposed";
      this.lifecycle.abort();
      this.epochLifecycle.abort();
      this.cancelSchedules();
      throw error;
    }
  }

  get epoch(): number {
    return this.epochValue;
  }

  get state(): "active" | "paused" | "disposed" {
    return this.stateValue;
  }

  render(epoch: number, viewport: ActivityViewport): ActivityFrame {
    this.assertEpoch(epoch, "render");
    validateViewport(viewport);
    this.invalidationPending = false;
    const frame = validateFrame(
      this.requireInstance().render(Object.freeze({ ...viewport })),
      viewport,
    );
    this.viewport = Object.freeze({ ...viewport });
    return frame;
  }

  handleInput(epoch: number, input: ActivityInput): void {
    this.assertEpoch(epoch, "input");
    validateInput(input);
    if (input.type === "mouse" && !this.mouseEnabled) {
      throw new ActivityContractError(`Activity ${this.activityId} did not opt in to mouse input`);
    }
    if (
      input.type === "mouse" &&
      (this.viewport === undefined ||
        input.row >= this.viewport.height ||
        input.column >= this.viewport.width)
    ) {
      throw new ActivityContractError("Activity mouse position is outside its rendered viewport");
    }
    this.requireInstance().handleInput(Object.freeze({ ...input }));
  }

  presentationChanged(epoch: number): void {
    this.assertEpoch(epoch, "presentation change");
    this.cancelSchedules();
    this.requireInstance().presentationChanged?.();
  }

  pause(epoch: number, reason: ActivityPauseReason): void {
    this.assertEpoch(epoch, "pause");
    this.stateValue = "paused";
    this.epochValue += 1;
    this.epochLifecycle.abort();
    this.cancelSchedules();
    this.invalidationPending = false;
    this.viewport = undefined;
    this.requireInstance().pause(reason);
  }

  resume(epoch: number): void {
    if (this.stateValue !== "paused" || epoch !== this.epochValue) {
      throw new ActivityContractError(`Activity ${this.activityId} resume used a stale epoch`);
    }
    this.stateValue = "active";
    this.epochValue += 1;
    this.epochLifecycle = new AbortController();
    this.requireInstance().resume();
  }

  serialize(epoch: number): JsonValue | undefined {
    if (this.stateValue === "disposed" || epoch !== this.epochValue) {
      throw new ActivityContractError(`Activity ${this.activityId} serialize used a stale epoch`);
    }
    const value = this.requireInstance().serialize();
    return value === undefined ? undefined : validateJson(value);
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.stateValue = "disposed";
    this.epochValue += 1;
    this.lifecycle.abort();
    this.epochLifecycle.abort();
    this.cancelSchedules();
    this.invalidationPending = false;
    this.viewport = undefined;
    const instance = this.instance;
    this.instance = undefined;
    this.onDisposed();
    this.disposal = Promise.resolve()
      .then(() => instance?.dispose())
      .then(() => undefined);
    return this.disposal;
  }

  private assertActive(): void {
    if (this.stateValue !== "active" || this.lifecycle.signal.aborted) {
      throw new ActivityContractError(`Activity ${this.activityId} context is stale`);
    }
  }

  private assertEpoch(epoch: number, operation: string): void {
    if (this.stateValue !== "active" || epoch !== this.epochValue) {
      throw new ActivityContractError(
        `Activity ${this.activityId} ${operation} used a stale epoch`,
      );
    }
  }

  private requireInstance(): TerminalActivityInstance {
    if (this.instance === undefined)
      throw new ActivityContractError(`Activity ${this.activityId} is disposed`);
    return this.instance;
  }

  private readNow(): number {
    const value = this.services.now();
    if (!Number.isFinite(value) || value < this.lastNow) {
      throw new ActivityContractError("Activity host clock must be finite and monotonic");
    }
    this.lastNow = value;
    return value;
  }

  private schedule(delayMs: number, callback: ActivityScheduledCallback): ExtensionDisposer {
    this.assertActive();
    if (
      !Number.isSafeInteger(delayMs) ||
      delayMs < 0 ||
      delayMs > ACTIVITY_LIMITS.maxScheduleDelayMs
    ) {
      throw new ActivityContractError("Activity schedule delay is outside host bounds");
    }
    const epoch = this.epochValue;
    const startedAt = this.readNow();
    let active = true;
    let cancelHost: ExtensionDisposer = () => undefined;
    const cancel = once(() => {
      if (!active) return;
      active = false;
      this.schedules.delete(cancel);
      return cancelHost();
    });
    cancelHost = this.services.schedule(delayMs, () => {
      if (!active) return;
      active = false;
      this.schedules.delete(cancel);
      if (this.stateValue !== "active" || this.epochValue !== epoch) return;
      callback(this.readNow() - startedAt);
    });
    if (active) this.schedules.add(cancel);
    return cancel;
  }

  private cancelSchedules(): void {
    for (const cancel of [...this.schedules]) cancel();
    this.schedules.clear();
  }

  private createStorage(): ActivityStorage {
    const adapter = this.services.storage;
    if (adapter === undefined) {
      throw new ActivityContractError("Activity storage capability has no host adapter");
    }
    const scope = Object.freeze({ extensionId: this.extensionId, activityId: this.activityId });
    const run = async <T>(
      signal: AbortSignal | undefined,
      operation: (combined: AbortSignal) => Promise<T>,
    ): Promise<T> => {
      this.assertActive();
      const epoch = this.epochValue;
      const signals = [this.lifecycle.signal, this.epochLifecycle.signal];
      if (signal !== undefined) signals.push(signal);
      const controller = new AbortController();
      const listeners = signals.map((source) => {
        const abort = () => controller.abort(source.reason);
        if (source.aborted) abort();
        else source.addEventListener("abort", abort, { once: true });
        return { source, abort };
      });
      const combined = controller.signal;
      try {
        if (combined.aborted) {
          throw new ActivityStorageError("aborted", "Activity storage operation was aborted");
        }
        let result: T;
        try {
          result = await operation(combined);
        } catch (error) {
          if (combined.aborted) {
            throw new ActivityStorageError("aborted", "Activity storage operation was aborted");
          }
          throw error;
        }
        if (this.stateValue !== "active" || this.epochValue !== epoch || combined.aborted) {
          throw new ActivityStorageError("aborted", "Activity storage context became stale");
        }
        return result;
      } finally {
        for (const { source, abort } of listeners) source.removeEventListener("abort", abort);
      }
    };
    const storage: ActivityStorage = {
      read: (signal?: AbortSignal) =>
        run(signal, async (combined) => {
          const value = await adapter.read(scope, combined);
          return value === undefined ? undefined : validateStoredValue(value);
        }),
      write: (expectedRevision, schemaVersion, value, signal?: AbortSignal) => {
        if (
          expectedRevision !== null &&
          (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
        ) {
          throw new ActivityStorageError(
            "invalid",
            "Expected revision must be null or a positive integer",
          );
        }
        if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
          throw new ActivityStorageError("invalid", "Schema version must be a positive integer");
        }
        const checked = validateJson(value);
        return run(signal, async (combined) => {
          const stored = validateStoredValue(
            await adapter.write(scope, expectedRevision, schemaVersion, checked, combined),
          );
          const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1;
          if (stored.revision !== nextRevision || stored.schemaVersion !== schemaVersion) {
            throw new ActivityStorageError(
              "invalid",
              "Storage adapter returned an invalid revision",
            );
          }
          return stored;
        });
      },
      reset: (expectedRevision, signal?: AbortSignal) => {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
          throw new ActivityStorageError("invalid", "Expected revision must be a positive integer");
        }
        return run(signal, (combined) => adapter.reset(scope, expectedRevision, combined));
      },
    };
    return Object.freeze(storage);
  }
}

/** Owns trusted terminal registrations without exposing client or daemon internals. */
export class TerminalExtensionHost {
  private readonly definitions: readonly TerminalExtension[];
  private readonly commandsByName = new Map<string, OwnedTerminalCommand>();
  private readonly shortcutsByKey = new Map<string, OwnedTerminalShortcut>();
  private readonly statusesByKey = new Map<string, OwnedStatus>();
  private readonly widgetsByKey = new Map<string, OwnedWidget>();
  private readonly toolRenderersByName = new Map<string, OwnedTerminalToolRenderer>();
  private readonly headers = new Map<string, OwnedWidget>();
  private readonly footers = new Map<string, OwnedWidget>();
  private readonly markdownTransformers: Array<{
    extensionId: string;
    transform: (text: string, source: "user" | "assistant") => string;
  }> = [];
  private readonly messageRenderers = new Map<
    string,
    { extensionId: string; render: TerminalEntryRenderer }
  >();
  private readonly entryRenderers = new Map<
    string,
    { extensionId: string; render: TerminalEntryRenderer }
  >();
  private readonly autocompleteProviders: Array<{
    extensionId: string;
    provider: TerminalAutocompleteProvider;
  }> = [];
  private editorComponent: { extensionId: string; component: TerminalEditorComponent } | undefined;
  private readonly uiFor: TerminalExtensionHostOptions["uiFor"];
  private readonly activitiesById = new Map<string, OwnedTerminalActivity>();
  private readonly activityInstances = new Map<string, Set<HostedActivity>>();
  private readonly listenersByEvent = new Map<
    TerminalExtensionEventInput["type"],
    Set<OwnedListener>
  >();
  private readonly workingLabels: Array<{ extensionId: string; label: string }> = [];
  private readonly pendingEvents = new Map<string, Set<Promise<Error | undefined>>>();
  private readonly lifecycles = new Map<string, AbortController>();
  private readonly activeExtensions = new Set<string>();
  private ownedDisposers: OwnedDisposer[] = [];
  private readonly cleanupTimeoutMs: number;
  private readonly inactiveExtensionIds: Set<string>;
  private widgetRevisionValue = 0;
  private active = false;

  constructor(
    definitions: readonly TerminalExtension[] = [],
    options: TerminalExtensionHostOptions = {},
  ) {
    this.definitions = [...definitions];
    this.uiFor = options.uiFor;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
    this.inactiveExtensionIds = new Set(options.initiallyInactiveExtensionIds ?? []);
    if (!Number.isSafeInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 1) {
      throw new ExtensionRegistrationError("cleanupTimeoutMs must be a positive integer");
    }
    const ids = new Set<string>();
    for (const definition of definitions) {
      const { id, name } = definition.manifest;
      if (!EXTENSION_ID.test(id))
        throw new ExtensionRegistrationError(`Invalid extension id ${id}`);
      if (typeof name !== "string" || !name.trim())
        throw new ExtensionRegistrationError(`Extension ${id} has no display name`);
      if (
        !Array.isArray(definition.manifest.capabilities) ||
        definition.manifest.capabilities.some(
          (capability) => !TERMINAL_CAPABILITIES.has(capability),
        )
      ) {
        throw new ExtensionRegistrationError(
          `Extension ${id} declares an unknown terminal capability`,
        );
      }
      if (ids.has(id)) throw new ExtensionRegistrationError(`Duplicate extension id ${id}`);
      ids.add(id);
    }
    for (const id of this.inactiveExtensionIds) {
      if (!ids.has(id))
        throw new ExtensionRegistrationError(`Unknown initially inactive extension ${id}`);
    }
  }

  async activate(): Promise<void> {
    if (this.active) throw new ExtensionRegistrationError("Terminal extensions are already active");
    this.active = true;
    try {
      for (const definition of this.definitions) {
        if (!this.inactiveExtensionIds.has(definition.manifest.id)) {
          await this.activateExtension(definition.manifest.id);
        }
      }
    } catch (error) {
      try {
        await this.dispose();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Extension activation cleanup failed");
      }
      throw error;
    }
  }

  async activateExtension(extensionId: string): Promise<void> {
    if (!this.active) throw new ExtensionRegistrationError("Terminal extension host is not active");
    if (this.activeExtensions.has(extensionId)) return;
    const definition = this.definitions.find((candidate) => candidate.manifest.id === extensionId);
    if (definition === undefined) {
      throw new ExtensionRegistrationError(`Unknown extension ${extensionId}`);
    }
    const lifecycle = new AbortController();
    this.lifecycles.set(extensionId, lifecycle);
    this.activeExtensions.add(extensionId);
    try {
      const cleanup = await definition.activate(this.apiFor(definition, lifecycle));
      if (cleanup !== undefined) {
        this.ownedDisposers.push({ extensionId, dispose: once(cleanup) });
      }
    } catch (error) {
      const activationError = new ExtensionRegistrationError(
        `Extension ${extensionId} failed to activate: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await this.deactivate(extensionId);
      } catch (cleanupError) {
        throw new AggregateError(
          [activationError, cleanupError],
          `Extension ${extensionId} activation rollback failed`,
        );
      }
      throw activationError;
    }
  }

  async setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
    if (!this.definitions.some((definition) => definition.manifest.id === extensionId)) {
      throw new ExtensionRegistrationError(`Unknown extension ${extensionId}`);
    }
    if (enabled) {
      this.inactiveExtensionIds.delete(extensionId);
      await this.activateExtension(extensionId);
    } else {
      this.inactiveExtensionIds.add(extensionId);
      await this.deactivate(extensionId);
    }
  }

  async deactivate(extensionId: string): Promise<void> {
    if (!this.activeExtensions.has(extensionId)) return;
    this.activeExtensions.delete(extensionId);
    this.lifecycles.get(extensionId)?.abort();
    this.lifecycles.delete(extensionId);
    const failures: unknown[] = [];
    const owned = this.ownedDisposers.filter((entry) => entry.extensionId === extensionId);
    this.ownedDisposers = this.ownedDisposers.filter((entry) => entry.extensionId !== extensionId);
    const pending: Promise<void>[] = [];
    for (const entry of owned.reverse()) {
      try {
        const result = entry.dispose();
        if (result !== undefined) {
          pending.push(
            Promise.resolve(result).catch((error: unknown) => {
              failures.push(error);
            }),
          );
        }
      } catch (error) {
        failures.push(error);
      }
    }
    const eventWork = [...(this.pendingEvents.get(extensionId) ?? [])].map((task) =>
      task.then((error) => {
        if (error !== undefined) failures.push(error);
      }),
    );
    this.pendingEvents.delete(extensionId);
    try {
      await withinCleanupBudget([...pending, ...eventWork], this.cleanupTimeoutMs);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Extension ${extensionId} cleanup failed`);
    }
  }

  async reload(): Promise<void> {
    await this.dispose();
    await this.activate();
  }

  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    for (const definition of [...this.definitions].reverse()) {
      try {
        await this.deactivate(definition.manifest.id);
      } catch (error) {
        failures.push(error);
      }
    }
    this.active = false;
    if (failures.length > 0)
      throw new AggregateError(failures, "Terminal extension cleanup failed");
  }

  extensionStates(): readonly { readonly id: string; readonly active: boolean }[] {
    return this.definitions.map((definition) => ({
      id: definition.manifest.id,
      active: this.activeExtensions.has(definition.manifest.id),
    }));
  }

  commands(): readonly OwnedTerminalCommand[] {
    return [...this.commandsByName.values()];
  }

  shortcuts(): readonly OwnedTerminalShortcut[] {
    return [...this.shortcutsByKey.values()];
  }

  statuses(): readonly TerminalLine[] {
    return [...this.statusesByKey.values()].map((status) => status.line);
  }

  get widgetRevision(): number {
    return this.widgetRevisionValue;
  }

  widgets(placement: "aboveEditor" | "belowEditor"): readonly TerminalWidget[] {
    return [...this.widgetsByKey.values()]
      .map((entry) => entry.widget)
      .filter((widget) => (widget.placement ?? "aboveEditor") === placement);
  }

  workingLabel(): string | undefined {
    return this.workingLabels.at(-1)?.label;
  }

  toolRenderer(name: string): OwnedTerminalToolRenderer | undefined {
    return this.toolRenderersByName.get(name);
  }

  header(): readonly TerminalWidget[] {
    return [...this.headers.values()].map((owned) => owned.widget);
  }
  footer(): readonly TerminalWidget[] {
    return [...this.footers.values()].map((owned) => owned.widget);
  }
  autocomplete(): readonly TerminalAutocompleteProvider[] {
    return this.autocompleteProviders.map((entry) => entry.provider);
  }

  editor(): TerminalEditorComponent | undefined {
    return this.editorComponent?.component;
  }

  transformMarkdown(text: string, source: "user" | "assistant"): string {
    let current = text;
    for (const { extensionId, transform } of this.markdownTransformers) {
      try {
        const result = transform(current, source);
        if (typeof result !== "string" || result.length > 1_000_000)
          throw new Error("invalid Markdown transformation");
        current = result;
      } catch (error) {
        return `[Extension ${extensionId} Markdown transformer failed: ${error instanceof Error ? error.message : String(error)}]\n${current}`;
      }
    }
    return current;
  }

  renderMessage(
    channel: string,
    value: unknown,
    width: number,
  ): readonly TerminalLine[] | undefined {
    return this.renderEntry(this.messageRenderers.get(channel), value, width);
  }

  renderCanonicalEntry(
    channel: string,
    value: unknown,
    width: number,
  ): readonly TerminalLine[] | undefined {
    return this.renderEntry(this.entryRenderers.get(channel), value, width);
  }

  private renderEntry(
    owned: { extensionId: string; render: TerminalEntryRenderer } | undefined,
    value: unknown,
    width: number,
  ): readonly TerminalLine[] | undefined {
    if (owned === undefined) return undefined;
    try {
      const lines = owned.render(value, width);
      if (
        lines !== undefined &&
        (!Array.isArray(lines) ||
          lines.length > 64 ||
          lines.some((line) => typeof line?.text !== "string"))
      ) {
        throw new Error("invalid renderer result");
      }
      return lines;
    } catch (error) {
      return [
        {
          text: `Extension ${owned.extensionId} renderer failed: ${error instanceof Error ? error.message : String(error)}`,
          tone: "error",
        },
      ];
    }
  }

  activities(): readonly OwnedTerminalActivity[] {
    return [...this.activitiesById.values()];
  }

  createActivity(activityId: string, services: ActivityHostServices): HostedActivityInstance {
    const activity = this.activitiesById.get(activityId);
    if (activity === undefined) {
      throw new ExtensionRegistrationError(`Unknown activity ${activityId}`);
    }
    const lifecycle = this.lifecycles.get(activity.extensionId);
    if (!this.active || lifecycle === undefined || lifecycle.signal.aborted) {
      throw new ExtensionRegistrationError(`Extension ${activity.extensionId} API is stale`);
    }
    let hosted: HostedActivity;
    const instances = this.activityInstances.get(activityId) ?? new Set<HostedActivity>();
    hosted = new HostedActivity(
      activity.extensionId,
      activity.id,
      services,
      activity.create,
      this.definitions
        .find((definition) => definition.manifest.id === activity.extensionId)
        ?.manifest.capabilities.includes("terminal.activity-storage") ?? false,
      activity.mouse === true,
      () => {
        instances.delete(hosted);
        if (instances.size === 0) this.activityInstances.delete(activityId);
      },
    );
    instances.add(hosted);
    this.activityInstances.set(activityId, instances);
    return hosted;
  }

  async emit(input: TerminalExtensionEventInput): Promise<readonly Error[]> {
    if (!this.active) return [];
    const tasks: Promise<Error | undefined>[] = [];
    for (const listener of this.listenersByEvent.get(input.type) ?? []) {
      const lifecycle = this.lifecycles.get(listener.extensionId);
      if (lifecycle === undefined || lifecycle.signal.aborted) continue;
      const event = { ...input, signal: lifecycle.signal } as TerminalExtensionEvent;
      const task = Promise.resolve()
        .then(() => (lifecycle.signal.aborted ? undefined : listener.handler(event)))
        .then(
          () => undefined,
          (error: unknown) =>
            new Error(
              `Extension ${listener.extensionId} ${event.type} handler failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
        );
      const pending = this.pendingEvents.get(listener.extensionId) ?? new Set();
      pending.add(task);
      this.pendingEvents.set(listener.extensionId, pending);
      void task.finally(() => {
        pending.delete(task);
        if (pending.size === 0) this.pendingEvents.delete(listener.extensionId);
      });
      tasks.push(task);
    }
    const results = await Promise.all(tasks);
    return results.filter((error): error is Error => error !== undefined);
  }

  private apiFor(definition: TerminalExtension, lifecycle: AbortController): TerminalExtensionApi {
    const extensionId = definition.manifest.id;
    const declared = new Set(definition.manifest.capabilities);
    const assertActive = (): void => {
      if (
        !this.active ||
        this.lifecycles.get(extensionId) !== lifecycle ||
        lifecycle.signal.aborted
      ) {
        throw new ExtensionRegistrationError(`Extension ${extensionId} API is stale`);
      }
    };
    const requireCapability = (capability: ExtensionCapability): void => {
      assertActive();
      if (!declared.has(capability)) {
        throw new ExtensionRegistrationError(
          `Extension ${extensionId} did not declare capability ${capability}`,
        );
      }
    };
    const ui = this.uiFor?.(lifecycle.signal) ?? headlessUi(lifecycle.signal);
    const own = (dispose: ExtensionDisposer): ExtensionDisposer => {
      const tracked = once(dispose);
      this.ownedDisposers.push({ extensionId, dispose: tracked });
      return tracked;
    };
    const registerSurface = (
      map: Map<string, OwnedWidget>,
      key: string,
      widget: TerminalWidget,
      capability: ExtensionCapability,
    ): ExtensionDisposer => {
      requireCapability(capability);
      const name = `${extensionId}:${key}`;
      if (map.has(name))
        throw new ExtensionRegistrationError(`Surface ${name} is already registered`);
      const owned = { extensionId, widget };
      map.set(name, owned);
      this.widgetRevisionValue += 1;
      return own(async () => {
        if (map.get(name) !== owned) return;
        map.delete(name);
        this.widgetRevisionValue += 1;
        await widget.dispose?.();
      });
    };
    const registerRenderer = (
      map: Map<string, { extensionId: string; render: TerminalEntryRenderer }>,
      channel: string,
      render: TerminalEntryRenderer,
    ): ExtensionDisposer => {
      requireCapability("terminal.entries");
      if (!ENTRY_CHANNEL.test(channel))
        throw new ExtensionRegistrationError(`Invalid entry channel ${channel}`);
      if (map.has(channel))
        throw new ExtensionRegistrationError(`Entry renderer ${channel} is already registered`);
      const owned = { extensionId, render };
      map.set(channel, owned);
      return own(() => {
        if (map.get(channel) === owned) map.delete(channel);
      });
    };
    return {
      get ui() {
        requireCapability("terminal.ui");
        return ui;
      },
      registerCommand: (command) => {
        requireCapability("terminal.commands");
        if (!COMMAND_NAME.test(command.name)) {
          throw new ExtensionRegistrationError(`Invalid command name ${command.name}`);
        }
        if (this.commandsByName.has(command.name)) {
          throw new ExtensionRegistrationError(`Command /${command.name} is already registered`);
        }
        const owned = { ...command, extensionId };
        this.commandsByName.set(command.name, owned);
        return own(() => {
          if (this.commandsByName.get(command.name) === owned)
            this.commandsByName.delete(command.name);
        });
      },
      registerShortcut: (shortcut) => {
        requireCapability("terminal.shortcuts");
        if (!shortcut.key) throw new ExtensionRegistrationError("Shortcut key cannot be empty");
        if (this.shortcutsByKey.has(shortcut.key)) {
          throw new ExtensionRegistrationError(`Shortcut ${shortcut.key} is already registered`);
        }
        const owned = { ...shortcut, extensionId };
        this.shortcutsByKey.set(shortcut.key, owned);
        return own(() => {
          if (this.shortcutsByKey.get(shortcut.key) === owned)
            this.shortcutsByKey.delete(shortcut.key);
        });
      },
      registerStatus: (key, line) => {
        requireCapability("terminal.status");
        const owned = { extensionId, line };
        this.statusesByKey.set(`${extensionId}:${key}`, owned);
        return own(() => {
          if (this.statusesByKey.get(`${extensionId}:${key}`) === owned) {
            this.statusesByKey.delete(`${extensionId}:${key}`);
          }
        });
      },
      registerWorkingLabel: (label) => {
        requireCapability("terminal.status");
        const owned = { extensionId, label };
        this.workingLabels.push(owned);
        return own(() => {
          const index = this.workingLabels.indexOf(owned);
          if (index >= 0) this.workingLabels.splice(index, 1);
        });
      },
      registerWidget: (key, widget) => {
        requireCapability("terminal.widgets");
        const owned = { extensionId, widget };
        const registryKey = `${extensionId}:${key}`;
        if (this.widgetsByKey.has(registryKey)) {
          throw new ExtensionRegistrationError(`Widget ${registryKey} is already registered`);
        }
        this.widgetsByKey.set(registryKey, owned);
        this.widgetRevisionValue += 1;
        return own(async () => {
          if (this.widgetsByKey.get(registryKey) !== owned) return;
          this.widgetsByKey.delete(registryKey);
          this.widgetRevisionValue += 1;
          await widget.dispose?.();
        });
      },
      registerHeader: (key, widget) =>
        registerSurface(this.headers, key, widget, "terminal.widgets"),
      registerFooter: (key, widget) =>
        registerSurface(this.footers, key, widget, "terminal.widgets"),
      registerMarkdownTransformer: (transform) => {
        requireCapability("terminal.markdown");
        const owned = { extensionId, transform };
        this.markdownTransformers.push(owned);
        return own(() => {
          const index = this.markdownTransformers.indexOf(owned);
          if (index >= 0) this.markdownTransformers.splice(index, 1);
        });
      },
      registerMessageRenderer: (channel, render) =>
        registerRenderer(this.messageRenderers, channel, render),
      registerEntryRenderer: (channel, render) =>
        registerRenderer(this.entryRenderers, channel, render),
      registerAutocompleteProvider: (provider) => {
        requireCapability("terminal.ui");
        const owned = { extensionId, provider };
        this.autocompleteProviders.push(owned);
        return own(() => {
          const index = this.autocompleteProviders.indexOf(owned);
          if (index >= 0) this.autocompleteProviders.splice(index, 1);
        });
      },
      registerEditor: (component) => {
        requireCapability("terminal.ui");
        if (this.editorComponent !== undefined)
          throw new ExtensionRegistrationError("Terminal editor is already registered");
        if (typeof component?.render !== "function" || typeof component.handleKey !== "function")
          throw new ExtensionRegistrationError(
            "Terminal editor must implement render and handleKey",
          );
        const owned = { extensionId, component };
        this.editorComponent = owned;
        return own(async () => {
          if (this.editorComponent !== owned) return;
          this.editorComponent = undefined;
          await component.dispose?.();
        });
      },
      registerToolRenderer: (toolName, renderer) => {
        requireCapability("terminal.tool-renderers");
        if (this.toolRenderersByName.has(toolName)) {
          throw new ExtensionRegistrationError(`Tool renderer ${toolName} is already registered`);
        }
        const owned = { extensionId, renderer };
        this.toolRenderersByName.set(toolName, owned);
        return own(() => {
          if (this.toolRenderersByName.get(toolName) === owned) {
            this.toolRenderersByName.delete(toolName);
          }
        });
      },
      registerActivity: (activity) => {
        requireCapability("terminal.activities");
        if (!EXTENSION_ID.test(activity.id)) {
          throw new ExtensionRegistrationError(`Invalid activity id ${activity.id}`);
        }
        if (!activity.name.trim() || !activity.description.trim()) {
          throw new ExtensionRegistrationError(
            `Activity ${activity.id} requires a name and description`,
          );
        }
        assertBoundedText(activity.name, "Activity name", 128);
        assertBoundedText(activity.description, "Activity description", 1_024);
        if (activity.category !== "game") {
          throw new ExtensionRegistrationError(
            `Activity ${activity.id} has an unsupported category`,
          );
        }
        if (activity.mouse !== undefined && typeof activity.mouse !== "boolean") {
          throw new ExtensionRegistrationError(`Activity ${activity.id} mouse support is invalid`);
        }
        if (activity.minimumViewport !== undefined) {
          validateViewport(activity.minimumViewport);
        }
        if (this.activitiesById.has(activity.id)) {
          throw new ExtensionRegistrationError(`Activity ${activity.id} is already registered`);
        }
        const owned = {
          ...activity,
          ...(activity.minimumViewport === undefined
            ? {}
            : { minimumViewport: Object.freeze({ ...activity.minimumViewport }) }),
          extensionId,
        };
        this.activitiesById.set(activity.id, owned);
        return own(async () => {
          if (this.activitiesById.get(activity.id) !== owned) return;
          this.activitiesById.delete(activity.id);
          const instances = [...(this.activityInstances.get(activity.id) ?? [])];
          await Promise.all(instances.map((instance) => instance.dispose()));
        });
      },
      on: (event, handler) => {
        requireCapability("terminal.events");
        if (!TERMINAL_EVENTS.has(event))
          throw new ExtensionRegistrationError(`Unknown terminal event ${event}`);
        // The event-keyed map preserves the narrowed handler's runtime event type.
        const owned: OwnedListener = { extensionId, handler: handler as OwnedListener["handler"] };
        const listeners = this.listenersByEvent.get(event) ?? new Set<OwnedListener>();
        listeners.add(owned);
        this.listenersByEvent.set(event, listeners);
        return own(() => {
          listeners.delete(owned);
          if (listeners.size === 0) this.listenersByEvent.delete(event);
        });
      },
      track: (disposer) => {
        assertActive();
        return own(disposer);
      },
    };
  }
}
