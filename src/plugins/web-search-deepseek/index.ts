import { bearer, jsonHeaders, readResultsReply, trimmed } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

/** Completes an API root or a `/v1` root; any other prefix is used as given. */
function toolsRoot(base: string): string {
  const url = new URL(trimmed(base));
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '' || path === '/v1') {
    url.pathname = '/v1/tools';
    return trimmed(url.href);
  }
  return trimmed(base);
}

/** `/v1/tools/search`, whether the deployment gave a root or the full endpoint. */
function searchUrl(base: string): string {
  const root = toolsRoot(base);
  return root.endsWith('/search') ? root : `${root}/search`;
}

export default defineSearchVendor({
  id: 'deepseek',
  buildRequest: ({ baseUrl, key, query, count }) => ({
    url: searchUrl(baseUrl),
    method: 'POST',
    headers: jsonHeaders(bearer(key)),
    // need_content stays false: whole pages do not belong in search context.
    body: JSON.stringify({ query, count, need_content: false }),
  }),
  readReply: readResultsReply,
});
