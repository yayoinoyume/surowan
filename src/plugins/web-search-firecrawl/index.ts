import { bearer, jsonHeaders, readFirecrawlReply, trimmed } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

export default defineSearchVendor({
  id: 'firecrawl',
  buildRequest: ({ baseUrl, key, query, count }) => ({
    url: `${trimmed(baseUrl)}/v2/search`,
    method: 'POST',
    headers: jsonHeaders(bearer(key)),
    body: JSON.stringify({ query, limit: count }),
  }),
  readReply: readFirecrawlReply,
});
