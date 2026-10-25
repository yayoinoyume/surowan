import { bearer, jsonHeaders, readResultsReply, trimmed } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

export default defineSearchVendor({
  id: 'tavily',
  buildRequest: ({ baseUrl, key, query, count }) => ({
    url: `${trimmed(baseUrl)}/search`,
    method: 'POST',
    headers: jsonHeaders(bearer(key)),
    body: JSON.stringify({
      query,
      max_results: count,
      search_depth: 'basic',
      include_answer: false,
    }),
  }),
  readReply: readResultsReply,
});
