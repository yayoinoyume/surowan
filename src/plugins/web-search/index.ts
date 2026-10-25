import { join } from 'node:path';
import { capability } from '../../capabilities/execute-tool.ts';
import type { RawConfig } from '../../platform/config.ts';
import { defaultSearchBase } from '../../platform/search-vendors.ts';
import { definePlugin } from '../plugin.ts';
import { SEARCH_VENDORS_POINT, type SearchVendorAdapter } from './vendor.ts';
import { createWebSearchTool, type WebSearchSettings } from './web-search.ts';

/** The section as enabled configuration; `undefined` when the switch is off. */
function webSearchSettings(config: RawConfig): NonNullable<RawConfig['web_search']> | undefined {
  const settings = config.web_search;
  return settings === undefined || settings.enabled === false ? undefined : settings;
}

/** One configured vendor behind `execute.call`; off unless `web_search` is set. */
export default definePlugin({
  id: 'web-search',
  // Read-only network access is part of the Playground's fixed capability set.
  hosts: ['telegram', 'playground'],
  // Vendor plugins contribute their adapters here; this plugin owns the point.
  provides: [SEARCH_VENDORS_POINT],
  skills: [
    {
      directory: join(import.meta.dirname, 'skills', 'web-search'),
      // The same conditions that decide whether the capability exists.
      visible: (config) => webSearchSettings(config)?.vendor !== undefined,
    },
  ],
  capabilities: ({ audit, config, deadline, resolveSecret, extensions, currentConfig }) => {
    // Read once per search, not once per invocation: a reload during a long
    // invocation changes the next call without remounting the tool.
    const read = (): WebSearchSettings | undefined => {
      const settings = webSearchSettings(currentConfig?.() ?? config);
      if (settings === undefined) {
        return undefined;
      }
      const vendor = settings.vendor;
      if (vendor === undefined) {
        return undefined;
      }
      const adapter = extensions(SEARCH_VENDORS_POINT).get(vendor) as SearchVendorAdapter | undefined;
      if (adapter === undefined) {
        return undefined;
      }
      const reference = settings.api_key;
      return {
        adapter,
        baseUrl: settings.base_url ?? defaultSearchBase(vendor, reference !== undefined),
        count: settings.count ?? 5,
        ...(settings.timeout_seconds === undefined ? {} : { timeoutMs: settings.timeout_seconds * 1_000 }),
        ...(reference === undefined
          ? {}
          : {
              apiKey: async () => {
                if (resolveSecret === undefined) {
                  throw new Error('web_search api_key cannot be resolved in this process');
                }
                return await resolveSecret(reference);
              },
            }),
      };
    };
    // Mounted only when the invocation starts with a usable section. Turning it
    // off later keeps the tool and answers `search_disabled`, which is a normal
    // tool failure rather than a vanishing tool.
    if (read() === undefined) {
      return [];
    }
    return [capability(createWebSearchTool({ audit, invocationDeadline: deadline, read }), false)];
  },
});
