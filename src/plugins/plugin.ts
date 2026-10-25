import type { PublicModel } from '@surowan/image-service';
import { basename } from 'node:path';
import type { ExecutableCapability } from '../capabilities/execute-tool.ts';
import type { ContextInjector } from '../context/context-injector.ts';
import type { RawConfig, SecretRef } from '../platform/config.ts';
import type { HostKind } from '../platform/im-host.ts';
import type { InvocationContext } from '../platform/invocation-context.ts';
import type { BusinessStore, Orm } from '../store/store.ts';
import { LongTaskService, type PluginTaskScope } from '../store/long-tasks.ts';
import { createToolAudit, type ToolAudit } from '../store/tool-audit.ts';

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

const HOST_KINDS: readonly HostKind[] = ['playground', 'telegram'];

/**
 * What the host hands a plugin when it assembles tools for one invocation.
 * `context` is the live invocation state, refreshed by hot injection, so tools
 * read it at call time instead of copying it.
 */
/**
 * The image-generation bridge a plugin sees. `undefined` when the host has no
 * image service wired (the plugin then contributes nothing).
 */
export interface ImagePluginBridge {
  /** The global image configuration is usable. */
  enabled(): boolean;
  /**
   * The conversation may submit new generations. A Telegram chat follows the
   * global switch; a Playground room is opt-in per room, so the same process
   * can serve both. Turning the switch off only blocks new submissions.
   */
  enabledFor(conversationId: bigint): boolean;
  submit(
    params: {
      conversationId: bigint;
      invocationId: bigint | null;
      toolCallId: string;
      authoredPrompt: string;
      modelId: string | undefined;
      aspectRatio: string | undefined;
      resolution: string | undefined;
      outputCount: number | undefined;
      inputMediaIds: readonly bigint[];
      extendedData: Record<string, unknown> | undefined;
    },
    signal?: AbortSignal,
  ): Promise<{
    generationId: string;
    replayed: boolean;
    modelId: string;
    outputCount: number;
  }>;
  modelList(): readonly PublicModel[];
}

export interface InvocationScope {
  readonly config: RawConfig;
  readonly context: InvocationContext;
  readonly deadline: number;
  readonly audit: ToolAudit;
  /** The host's database, for plugins that contribute their own queries. */
  readonly orm: Orm;
  /** Per-plugin task scope bound to the current conversation. */
  readonly tasks: PluginTaskScope;
  /**
   * Resolves a conversation-authorized media reference (img_…) to its media id.
   * Absent when the host did not wire reference resolution.
   */
  readonly resolveMedia?: (ref: string) => bigint | undefined;
  /** Image-generation bridge; `undefined` = the host runs without one. */
  readonly image?: ImagePluginBridge;
  /** Resolves a SecretRef through the deployment's key jar, env or command. */
  readonly resolveSecret?: (reference: SecretRef) => Promise<string>;
  /** Implementations of one extension point, keyed by contribution name. */
  readonly extensions: (pointId: string) => ReadonlyMap<string, unknown>;
  /**
   * The configuration the process published most recently, read at call time.
   * A tool that bills per call uses this so a reload between two calls in one
   * long invocation applies. Absent when the host did not wire it (tests, tools
   * assembled outside `serve`).
   */
  readonly currentConfig?: () => RawConfig;
}

/** A skill directory, optionally gated on the configuration the host is using. */
export interface PluginSkill {
  /** Absolute directory; its basename is the skill name and holds SKILL.md. */
  readonly directory: string;
  /**
   * Configuration-state visibility, read by the host when it builds the skill
   * index. Session-state gates (image generation per conversation) stay in the
   * host: a plugin has no conversation at load time.
   */
  readonly visible?: (config: RawConfig) => boolean;
}

/**
 * A built-in agent plugin. It only declares contributions; the host decides
 * when to assemble them. Lifecycle hooks are added once a plugin needs one.
 */
export interface AgentPlugin {
  readonly id: string;
  /**
   * Hosts this plugin may run on. Omitted means Telegram only: a new plugin
   * never drifts into the Playground just because it exists.
   */
  readonly hosts?: readonly HostKind[];
  /**
   * Plugin ids this one depends on. Each must exist, load earlier, and the
   * ordering rule rules out cycles as well. A contribution requires its owner.
   */
  readonly requires?: readonly string[];
  /** Extension points this plugin declares; every id must start with `<id>.`. */
  readonly provides?: readonly string[];
  /** Implementations by extension point id, then by implementation name. */
  readonly contributes?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Skill directories; a string is shorthand for `{ directory }`. */
  readonly skills?: readonly (string | PluginSkill)[];
  /** Runtime-internal capabilities, dispatched and audited through `execute`. */
  readonly capabilities?: (scope: InvocationScope) => readonly ExecutableCapability[];
  /** Per-batch context injectors, run in plugin load order. */
  readonly contextInjectors?: readonly ContextInjector[];
}

/** Type helper for plugin modules. It validates nothing: `loadPlugins` does. */
export function definePlugin<const T extends AgentPlugin>(plugin: T): T {
  return plugin;
}

export interface LoadPluginsOptions {
  /** Image-generation bridge handed to plugins that opt in (`scope.image`). */
  readonly image?: ImagePluginBridge;
  /** Conversation media-reference resolver handed to plugins (`scope.resolveMedia`). */
  readonly resolveMedia?: (ref: string) => bigint | undefined;
  /** SecretRef resolver handed to plugins (`scope.resolveSecret`); see `SecretStore`. */
  readonly resolveSecret?: (reference: SecretRef) => Promise<string>;
  /** Live configuration accessor handed to plugins (`scope.currentConfig`). */
  readonly currentConfig?: () => RawConfig;
}

export interface LoadedPlugins {
  /** Mounted under system:///skills/ next to the bundled tree, see `FileSystemResources.load`. */
  readonly skillDirectories: readonly string[];
  /** Skill name to the hosts that mount it. Unlisted skills are host-neutral. */
  readonly skillHosts: ReadonlyMap<string, readonly HostKind[]>;
  /** Whether one skill is visible under the given configuration. */
  skillVisible(name: string, config: RawConfig): boolean;
  /** Implementations of one extension point; empty when nobody contributes. */
  extensions(pointId: string): ReadonlyMap<string, unknown>;
  /** All plugins' context injectors, in plugin load order. */
  readonly contextInjectors: readonly ContextInjector[];
  capabilities(
    store: BusinessStore,
    config: RawConfig,
    context: InvocationContext,
    deadline: number,
    tasks?: LongTaskService,
    resolveMedia?: (ref: string) => bigint | undefined,
  ): readonly ExecutableCapability[];
}

/**
 * Validates plugin definitions and merges their contributions. Skill name
 * conflicts surface when the skill directories are loaded, capability name
 * conflicts when the execute registry is built, injector name conflicts here.
 */
export function loadPlugins(plugins: readonly AgentPlugin[], options: LoadPluginsOptions = {}): LoadedPlugins {
  const positions = new Map<string, number>();
  for (const [index, plugin] of plugins.entries()) {
    if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
      throw new Error(`Plugin id is invalid: ${plugin.id}`);
    }
    if (positions.has(plugin.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.id}`);
    }
    pluginHosts(plugin);
    positions.set(plugin.id, index);
  }
  assertPluginGraph(plugins, positions);
  const points = collectExtensionPoints(plugins);
  const extensionValues = collectContributions(plugins, points);
  const skills = plugins.flatMap((plugin) =>
    (plugin.skills ?? []).map((skill) => ({
      ...(typeof skill === 'string' ? { directory: skill } : skill),
      hosts: pluginHosts(plugin),
    })),
  );
  const visibility = new Map<string, (config: RawConfig) => boolean>();
  for (const skill of skills) {
    if (skill.visible !== undefined) {
      visibility.set(basename(skill.directory), skill.visible);
    }
  }
  const injectorNames = new Set<string>();
  // An injector runs only where its plugin runs: it inherits the plugin's
  // hosts, narrowed further by its own list. Without this an injector of a
  // Telegram-only plugin would still render for a room and read its internal
  // chat id as a Telegram one.
  const contextInjectors: readonly ContextInjector[] = plugins.flatMap((plugin) => {
    const hosts = pluginHosts(plugin);
    return (plugin.contextInjectors ?? []).map((injector) => withHosts(injector, hosts));
  });
  for (const injector of contextInjectors) {
    if (!PLUGIN_ID_PATTERN.test(injector.name)) {
      throw new Error(`Context injector name is invalid: ${injector.name}`);
    }
    if (injectorNames.has(injector.name)) {
      throw new Error(`Duplicate context injector name: ${injector.name}`);
    }
    injectorNames.add(injector.name);
  }
  return {
    skillDirectories: skills.map((skill) => skill.directory),
    skillHosts: new Map(skills.map((skill) => [basename(skill.directory), skill.hosts] as const)),
    skillVisible: (name, config) => visibility.get(name)?.(config) ?? true,
    extensions: (pointId) => extensionValues.get(pointId) ?? NO_EXTENSIONS,
    contextInjectors,
    capabilities: (store, config, context, deadline, suppliedTasks, resolveMedia) => {
      const audit = createToolAudit(store, context.invocationId);
      const service = suppliedTasks ?? new LongTaskService(store.orm);
      return plugins.flatMap((plugin) => {
        const hosts = pluginHosts(plugin);
        if (!hosts.includes(context.hostKind)) {
          return [];
        }
        const scope: InvocationScope = {
          config,
          context,
          deadline,
          audit,
          orm: store.orm,
          tasks: context.invocationId === 0n ? unavailableTasks() : service.invocationScope(plugin.id, context, hosts),
          ...(resolveMedia === undefined ? {} : { resolveMedia }),
          ...(options.image === undefined ? {} : { image: options.image }),
          ...(options.resolveSecret === undefined ? {} : { resolveSecret: options.resolveSecret }),
          extensions: (pointId) => extensionValues.get(pointId) ?? NO_EXTENSIONS,
          ...(options.currentConfig === undefined ? {} : { currentConfig: options.currentConfig }),
        };
        return plugin.capabilities?.(scope) ?? [];
      });
    },
  };
}

const NO_EXTENSIONS: ReadonlyMap<string, unknown> = new Map();

/**
 * Dependencies must exist and load earlier. Ordering also rules out cycles:
 * a cycle always contains at least one edge pointing forward.
 */
function assertPluginGraph(plugins: readonly AgentPlugin[], positions: ReadonlyMap<string, number>): void {
  for (const [index, plugin] of plugins.entries()) {
    for (const dependency of plugin.requires ?? []) {
      const position = positions.get(dependency);
      if (position === undefined) {
        throw new Error(`Plugin ${plugin.id} requires unknown plugin: ${dependency}`);
      }
      // Self-dependency and cycles both fail here: neither can load earlier.
      if (position >= index) {
        throw new Error(`Plugin ${plugin.id} requires ${dependency}, which must load before it`);
      }
    }
  }
}

/**
 * Point ids are namespaced by their declaring plugin, so ownership is
 * unambiguous and two plugins cannot declare the same point: ids are unique.
 */
function collectExtensionPoints(plugins: readonly AgentPlugin[]): ReadonlyMap<string, string> {
  const points = new Map<string, string>();
  for (const plugin of plugins) {
    for (const point of plugin.provides ?? []) {
      if (!point.startsWith(`${plugin.id}.`)) {
        throw new Error(`Plugin ${plugin.id} declares extension point outside its id: ${point}`);
      }
      points.set(point, plugin.id);
    }
  }
  return points;
}

/**
 * A contribution must name its owner in `requires`, so the dependency graph is
 * the single place that records why one plugin needs another. Names are unique
 * per point so a duplicate adapter fails loudly instead of being overwritten.
 */
function collectContributions(
  plugins: readonly AgentPlugin[],
  points: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReadonlyMap<string, unknown>> {
  const result = new Map<string, Map<string, unknown>>();
  for (const plugin of plugins) {
    const requires = plugin.requires ?? [];
    for (const [pointId, entries] of Object.entries(plugin.contributes ?? {})) {
      const owner = points.get(pointId);
      if (owner === undefined) {
        throw new Error(`Plugin ${plugin.id} contributes to undeclared extension point: ${pointId}`);
      }
      if (!requires.includes(owner)) {
        throw new Error(`Plugin ${plugin.id} contributes to ${pointId} without requiring ${owner}`);
      }
      const bucket = result.get(pointId) ?? new Map<string, unknown>();
      for (const [name, value] of Object.entries(entries)) {
        if (bucket.has(name)) {
          throw new Error(`Duplicate contribution ${name} for extension point ${pointId}`);
        }
        bucket.set(name, value);
      }
      result.set(pointId, bucket);
    }
  }
  return result;
}

function withHosts(injector: ContextInjector, pluginHosts: readonly HostKind[]): ContextInjector {
  const hosts = pluginHosts.filter((host) => injector.hosts === undefined || injector.hosts.includes(host));
  return {
    name: injector.name,
    hosts,
    collect: (text) => injector.collect(text),
    render: (input) => injector.render(input),
  };
}

/** The hosts a plugin was declared for. Omitted or empty means Telegram only. */
export function pluginHosts(plugin: AgentPlugin): readonly HostKind[] {
  const hosts = plugin.hosts === undefined || plugin.hosts.length === 0 ? (['telegram'] as const) : plugin.hosts;
  for (const host of hosts) {
    if (!HOST_KINDS.includes(host)) {
      throw new Error(`Plugin ${plugin.id} declares an unknown host: ${String(host)}`);
    }
  }
  return hosts;
}

function unavailableTasks(): PluginTaskScope {
  const unavailable = (): never => {
    throw new Error('LongTaskService is not available outside a live invocation');
  };
  return {
    create: unavailable,
    get: unavailable,
    list: unavailable,
    complete: unavailable,
    fail: unavailable,
    cancel: unavailable,
  };
}
