import { jsonHeaders, queryUrl, readYouReply, trimmed } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

export default defineSearchVendor({
  id: 'you',
  buildRequest: ({ baseUrl, key, query, count }) =>
    key === undefined
      ? {
          url: queryUrl(baseUrl, '/v1/agents/search', { query, count: String(count) }),
          method: 'GET',
          headers: { accept: 'application/json' },
        }
      : {
          url: `${trimmed(baseUrl)}/v1/search`,
          method: 'POST',
          headers: jsonHeaders({ 'x-api-key': key }),
          body: JSON.stringify({ query, count }),
        },
  readReply: readYouReply,
});
