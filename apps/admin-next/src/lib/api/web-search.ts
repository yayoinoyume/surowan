import { call, writeHeaders } from './core.ts';
import type { ModelApplySummary } from './models.ts';

export interface SearchVendorView {
  readonly id: string;
  readonly label: string;
  readonly default_base_url: string | null;
  readonly needs_base_url: boolean;
}

export interface WebSearchConfigView {
  readonly revision: string;
  readonly config: {
    readonly enabled: boolean;
    readonly vendor?: string;
    readonly base_url?: string;
    readonly api_key_configured: boolean;
    readonly count: number;
    readonly timeout_seconds: number;
  };
  readonly vendors: readonly SearchVendorView[];
}

export interface WebSearchUpdate {
  readonly enabled?: boolean;
  readonly vendor?: string;
  /** `null` removes the override; omitted leaves it unchanged. */
  readonly base_url?: string | null;
  /** `null` removes the key; a string stores a new one in the jar. */
  readonly api_key?: string | null;
  readonly count?: number;
  readonly timeout_seconds?: number;
}

export interface WebSearchWriteResult extends WebSearchConfigView {
  readonly apply: ModelApplySummary;
}

export function getWebSearchConfig(): Promise<WebSearchConfigView> {
  return call<WebSearchConfigView>('/web-search/config');
}

export function updateWebSearchConfig(body: WebSearchUpdate, revision: string): Promise<WebSearchWriteResult> {
  return call<WebSearchWriteResult>('/web-search/config', {
    method: 'PUT',
    headers: writeHeaders(revision),
    body: JSON.stringify(body),
  });
}
