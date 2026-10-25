/**
 * Search vendors behind `web_search`. Only data lives here: the configuration
 * schema and its validator run before any plugin loads, so this module must not
 * depend on the plugin layer. Each vendor's wire protocol lives in
 * `src/plugins/web-search-<id>/` and contributes an adapter to the plugin.
 */

export const SEARCH_VENDOR_IDS = ['tavily', 'brave', 'exa', 'firecrawl', 'deepseek', 'searxng', 'you'] as const;

export type SearchVendorId = (typeof SEARCH_VENDOR_IDS)[number];

export interface SearchVendorSpec {
  readonly label: string;
  /** `null` when the deployment must supply the address (SearXNG). */
  readonly defaultBaseUrl: string | null;
  /** Where to go when the deployment configured no key (You.com's free tier). */
  readonly keylessBaseUrl?: string;
  /** `false` for a vendor that answers anonymously (SearXNG, You.com's free tier). */
  readonly keyRequired: boolean;
  /** The longest query it accepts; a longer one is clipped before sending. */
  readonly queryMax: number;
}

export const SEARCH_VENDORS: Readonly<Record<SearchVendorId, SearchVendorSpec>> = {
  // Tavily documents a 400-character maximum for its query.
  tavily: { label: 'Tavily', defaultBaseUrl: 'https://api.tavily.com', keyRequired: true, queryMax: 400 },
  // Brave allows 600; 400 is a conservative clip that never fails a request.
  brave: {
    label: 'Brave Search',
    defaultBaseUrl: 'https://api.search.brave.com',
    keyRequired: true,
    queryMax: 400,
  },
  exa: { label: 'Exa', defaultBaseUrl: 'https://api.exa.ai', keyRequired: true, queryMax: 500 },
  firecrawl: { label: 'Firecrawl', defaultBaseUrl: 'https://api.firecrawl.dev', keyRequired: true, queryMax: 500 },
  deepseek: { label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', keyRequired: true, queryMax: 128 },
  searxng: { label: 'SearXNG', defaultBaseUrl: null, keyRequired: false, queryMax: 500 },
  you: {
    label: 'You.com',
    defaultBaseUrl: 'https://ydc-index.io',
    keylessBaseUrl: 'https://api.you.com',
    keyRequired: false,
    queryMax: 500,
  },
};

/** The longest query any vendor accepts; each vendor clips to its own limit. */
export const MAX_SEARCH_QUERY_CHARS = 500;

/** The address a vendor is asked at: the configured one, else its own. */
export function defaultSearchBase(vendor: SearchVendorId, hasKey: boolean): string {
  const spec = SEARCH_VENDORS[vendor];
  if (!hasKey && spec.keylessBaseUrl !== undefined) {
    return spec.keylessBaseUrl;
  }
  if (spec.defaultBaseUrl === null) {
    throw new Error(`${spec.label} requires base_url`);
  }
  return spec.defaultBaseUrl;
}

export function clipQuery(vendor: SearchVendorId, query: string): string {
  const limit = SEARCH_VENDORS[vendor].queryMax;
  return query.length > limit ? query.slice(0, limit) : query;
}
