import type { SearchVendorId } from '../../platform/search-vendors.ts';
import type { AgentPlugin } from '../plugin.ts';

/** The extension point vendor plugins contribute to. */
export const SEARCH_VENDORS_POINT = 'web-search.vendors';

export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly text: string;
  readonly date?: string;
}

export interface SearchRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * One vendor's wire protocol. The label, default address, key requirement and
 * query limit live in `SEARCH_VENDORS`, which the configuration layer also
 * reads, so an adapter only adds the two functions the plugin calls.
 */
export interface SearchVendorAdapter {
  /** Short id, also the `web_search.vendor` value. */
  readonly id: SearchVendorId;
  buildRequest(input: {
    readonly baseUrl: string;
    readonly key: string | undefined;
    readonly query: string;
    readonly count: number;
  }): SearchRequest;
  readReply(body: string): readonly SearchHit[];
}

/**
 * A vendor plugin contributes its adapter to the point `web-search` declares.
 * The host builds the adapter registry once and the search plugin reads it per
 * invocation, so a vendor never needs to know about auditing or deadlines.
 */
export function defineSearchVendor(adapter: SearchVendorAdapter): AgentPlugin {
  return {
    id: `web-search-${adapter.id}`,
    // The adapter is read from the registry, not mounted per host, so both
    // hosts use it. Declaring them keeps a future capability from silently
    // disappearing in the Playground.
    hosts: ['telegram', 'playground'],
    requires: ['web-search'],
    contributes: { [SEARCH_VENDORS_POINT]: { [adapter.id]: adapter } },
  };
}
