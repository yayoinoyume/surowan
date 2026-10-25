import { jsonHeaders, readResultsReply, trimmed } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

export default defineSearchVendor({
  id: 'exa',
  buildRequest: ({ baseUrl, key, query, count }) => ({
    url: `${trimmed(baseUrl)}/search`,
    method: 'POST',
    headers: jsonHeaders(key === undefined ? {} : { 'x-api-key': key }),
    body: JSON.stringify({
      query,
      numResults: count,
      contents: { text: { maxCharacters: 2_000 } },
    }),
  }),
  readReply: readResultsReply,
});
