/**
 * `/api/web-search/config`: the one section the panel owns, plus the vendor
 * specs the form needs. The specs come from the platform registry, which is
 * also what configuration validation reads, so the form cannot offer a vendor
 * the runtime would reject.
 */
import type { FileConfig } from '../../platform/config.ts';
import type { ConfigController, ConfigEdit } from '../../platform/config-write.ts';
import { secretEdit } from '../../platform/config-write.ts';
import { SEARCH_VENDOR_IDS, SEARCH_VENDORS, type SearchVendorId } from '../../platform/search-vendors.ts';
import type { SecretStore } from '../../platform/secrets.ts';
import { json, readJsonObject, redact, requiredRevision, revisionRequired } from './admin-http.ts';
import { AdminQueryError } from './audit.ts';
import { CONFIG_WRITE_STATUS, readConfigFile } from './config-file-admin.ts';

export interface WebSearchAdminDeps {
  readonly configReloader: ConfigController | undefined;
  readonly secrets: SecretStore | undefined;
}

interface WebSearchViewSource {
  readonly file: FileConfig;
  readonly revision: string;
}

function vendorsView() {
  return SEARCH_VENDOR_IDS.map((id) => {
    const spec = SEARCH_VENDORS[id];
    return {
      id,
      label: spec.label,
      default_base_url: spec.defaultBaseUrl,
      needs_base_url: spec.defaultBaseUrl === null,
    };
  });
}

/**
 * The panel-facing view. `api_key_configured` is a boolean by design: the
 * SecretRef may point at the jar, an environment variable or a command, and
 * none of those should be distinguishable from the response.
 */
function webSearchView(source: WebSearchViewSource) {
  const section = source.file.web_search;
  return {
    revision: source.revision,
    config: {
      enabled: section?.enabled ?? true,
      vendor: section?.vendor,
      base_url: section?.base_url,
      api_key_configured: section?.api_key !== undefined,
      count: section?.count ?? 5,
      timeout_seconds: section?.timeout_seconds ?? 15,
    },
    vendors: vendorsView(),
  };
}

interface WebSearchPatch {
  enabled?: boolean;
  vendor?: SearchVendorId;
  /** `null` removes the override; `undefined` leaves it unchanged. */
  baseUrl?: string | null;
  /** `null` removes the key; a string stores a new one in the jar. */
  apiKey?: string | null;
  count?: number;
  timeoutSeconds?: number;
}

const PATCH_FIELDS = new Set(['enabled', 'vendor', 'base_url', 'api_key', 'count', 'timeout_seconds']);

function parsePatch(body: Record<string, unknown>): WebSearchPatch {
  for (const key of Object.keys(body)) {
    if (!PATCH_FIELDS.has(key)) {
      throw new AdminQueryError('invalid_body', `Unknown field: ${key}`);
    }
  }
  const patch: WebSearchPatch = {};
  if (Object.hasOwn(body, 'enabled')) {
    if (typeof body.enabled !== 'boolean') {
      throw new AdminQueryError('invalid_body', 'enabled must be a boolean');
    }
    patch.enabled = body.enabled;
  }
  if (Object.hasOwn(body, 'vendor')) {
    if (typeof body.vendor !== 'string' || !SEARCH_VENDOR_IDS.includes(body.vendor as SearchVendorId)) {
      throw new AdminQueryError('invalid_body', 'vendor must be a registered search vendor');
    }
    patch.vendor = body.vendor as SearchVendorId;
  }
  if (Object.hasOwn(body, 'base_url')) {
    if (body.base_url !== null && (typeof body.base_url !== 'string' || body.base_url.trim() === '')) {
      throw new AdminQueryError('invalid_body', 'base_url must be a non-empty string or null');
    }
    patch.baseUrl = body.base_url as string | null;
  }
  if (Object.hasOwn(body, 'api_key')) {
    if (body.api_key !== null) {
      if (
        typeof body.api_key !== 'string' ||
        body.api_key.length === 0 ||
        /\s/u.test(body.api_key) ||
        /\p{Cc}/u.test(body.api_key)
      ) {
        throw new AdminQueryError('invalid_body', 'api_key must be a non-empty string without whitespace, or null');
      }
    }
    patch.apiKey = body.api_key as string | null;
  }
  if (Object.hasOwn(body, 'count')) {
    if (!Number.isInteger(body.count) || (body.count as number) < 1 || (body.count as number) > 10) {
      throw new AdminQueryError('invalid_body', 'count must be an integer between 1 and 10');
    }
    patch.count = body.count as number;
  }
  if (Object.hasOwn(body, 'timeout_seconds')) {
    const value = body.timeout_seconds;
    if (!Number.isInteger(value) || (value as number) < 5 || (value as number) > 30) {
      throw new AdminQueryError('invalid_body', 'timeout_seconds must be an integer between 5 and 30');
    }
    patch.timeoutSeconds = value as number;
  }
  return patch;
}

function collectEdits(section: FileConfig['web_search'], patch: WebSearchPatch): ConfigEdit[] {
  const edits: ConfigEdit[] = [];
  const scalar = (field: string, next: unknown, current: unknown): void => {
    if (next !== current) {
      edits.push({ path: ['web_search', field], value: next });
    }
  };
  if (patch.enabled !== undefined) {
    scalar('enabled', patch.enabled, section?.enabled);
  }
  if (patch.vendor !== undefined) {
    scalar('vendor', patch.vendor, section?.vendor);
  }
  if (patch.baseUrl !== undefined) {
    scalar('base_url', patch.baseUrl === null ? undefined : patch.baseUrl, section?.base_url);
  }
  if (patch.apiKey === null) {
    if (section?.api_key !== undefined) {
      edits.push({ path: ['web_search', 'api_key'], value: undefined });
    }
  } else if (patch.apiKey !== undefined) {
    // A new plaintext always gets a fresh jar entry; the file keeps only the name.
    edits.push(secretEdit(['web_search', 'api_key'], patch.apiKey));
  }
  if (patch.count !== undefined) {
    scalar('count', patch.count, section?.count);
  }
  if (patch.timeoutSeconds !== undefined) {
    scalar('timeout_seconds', patch.timeoutSeconds, section?.timeout_seconds);
  }
  return edits;
}

export function createWebSearchAdminHandler(deps: WebSearchAdminDeps) {
  const { configReloader, secrets } = deps;

  const view = async (reloader: ConfigController): Promise<Response> => {
    const { loaded, revision } = await readConfigFile(reloader, secrets);
    return json(webSearchView({ file: loaded.fileConfig, revision }));
  };

  const write = async (reloader: ConfigController, request: Request): Promise<Response> => {
    const revision = requiredRevision(request);
    if (revision === null) {
      return revisionRequired();
    }
    const patch = parsePatch(await readJsonObject(request));
    if (patch.apiKey !== undefined && patch.apiKey !== null) {
      // Registered before the write so every later error path can redact it.
      secrets?.remember(patch.apiKey);
    }
    const { loaded, revision: currentRevision } = await readConfigFile(reloader, secrets);
    if (revision !== currentRevision) {
      return json({ error: 'config_conflict', message: 'The configuration file changed; reload before editing' }, 409);
    }
    const edits = collectEdits(loaded.fileConfig.web_search, patch);
    if (edits.length === 0) {
      return json({
        ...webSearchView({ file: loaded.fileConfig, revision: currentRevision }),
        apply: { applied: [], restart_required: reloader.status().restartRequired, outside_serve: [] },
      });
    }
    const result = await reloader.writeAndApply(edits, revision);
    if (!result.ok) {
      const message = result.fileWritten
        ? `config.jsonc was updated but not applied: ${result.message}`
        : result.message;
      return json({ error: result.code, message: redact(secrets, message) }, CONFIG_WRITE_STATUS[result.code] ?? 409);
    }
    const next = await readConfigFile(reloader, secrets);
    return json({
      ...webSearchView({ file: next.loaded.fileConfig, revision: next.revision }),
      apply: { applied: result.applied, restart_required: result.restartRequired, outside_serve: result.outsideServe },
    });
  };

  return {
    async handle(request: Request, segments: readonly string[]): Promise<Response | undefined> {
      if (segments.length !== 2 || segments[0] !== 'web-search' || segments[1] !== 'config') {
        return undefined;
      }
      const reloader = configReloader;
      if (reloader === undefined) {
        return json({ error: 'config_reload_unavailable', message: 'Configuration reloading is not wired' }, 503);
      }
      if (request.method === 'GET') {
        return await view(reloader);
      }
      if (request.method === 'PUT') {
        return await write(reloader, request);
      }
      return json({ error: 'method_not_allowed', message: 'Unsupported web-search operation' }, 405);
    },
  };
}
