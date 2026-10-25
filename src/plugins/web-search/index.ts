import { join } from 'node:path';
import { capability } from '../../capabilities/execute-tool.ts';
import type { RawConfig } from '../../platform/config.ts';
import { defaultSearchBase } from '../../platform/search-vendors.ts';
import { definePlugin } from '../plugin.ts';
import { createWebSearchTool } from './web-search.ts';

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
  skills: [
    {
      directory: join(import.meta.dirname, 'skills', 'web-search'),
      // The same conditions that decide whether the capability exists.
      visible: (config) => webSearchSettings(config)?.vendor !== undefined,
    },
  ],
  capabilities: ({ audit, config, deadline, resolveSecret }) => {
    const settings = webSearchSettings(config);
    if (settings === undefined) {
      return [];
    }
    const vendor = settings.vendor;
    if (vendor === undefined) {
      return [];
    }
    const baseUrl = settings.base_url ?? defaultSearchBase(vendor, settings.api_key !== undefined);
    const reference = settings.api_key;
    return [
      capability(
        createWebSearchTool({
          audit,
          invocationDeadline: deadline,
          vendor,
          baseUrl,
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
        }),
        false,
      ),
    ];
  },
});
