import { queryUrl, readBraveReply } from '../web-search/shared.ts';
import { defineSearchVendor } from '../web-search/vendor.ts';

export default defineSearchVendor({
  id: 'brave',
  buildRequest: ({ baseUrl, key, query, count }) => ({
    url: queryUrl(baseUrl, '/res/v1/web/search', { q: query, count: String(count) }),
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(key === undefined ? {} : { 'x-subscription-token': key }),
    },
  }),
  readReply: readBraveReply,
});
