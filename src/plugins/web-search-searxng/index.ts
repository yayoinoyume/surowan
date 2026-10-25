import { queryUrl, readResultsReply } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

export default defineSearchVendor({
  id: 'searxng',
  buildRequest: ({ baseUrl, query }) => ({
    url: queryUrl(baseUrl, '/search', { q: query, format: 'json' }),
    method: 'GET',
    headers: { accept: 'application/json' },
  }),
  readReply: readResultsReply,
});
