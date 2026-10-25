import alarm from './alarm/index.ts';
import dictionary from './dictionary/index.ts';
import image from './image/index.ts';
import type { AgentPlugin } from './plugin.ts';
import webFetch from './web-fetch/index.ts';
import webSearchBrave from './web-search-brave/index.ts';
import webSearchDeepseek from './web-search-deepseek/index.ts';
import webSearchExa from './web-search-exa/index.ts';
import webSearchFirecrawl from './web-search-firecrawl/index.ts';
import webSearchSearxng from './web-search-searxng/index.ts';
import webSearchTavily from './web-search-tavily/index.ts';
import webSearchYou from './web-search-you/index.ts';
import webSearch from './web-search/index.ts';

/**
 * Built-in agent plugins. Every composition root loads this same list. The
 * order is significant: a plugin that contributes to an extension point must
 * appear after the plugin that declares it. The image plugin contributes
 * nothing unless the host wired an image bridge and generation is enabled, so
 * runtimes without image configuration are unaffected.
 */
export const BUILTIN_PLUGINS: readonly AgentPlugin[] = [
  webFetch,
  webSearch,
  webSearchTavily,
  webSearchBrave,
  webSearchExa,
  webSearchFirecrawl,
  webSearchDeepseek,
  webSearchSearxng,
  webSearchYou,
  image,
  alarm,
  dictionary,
];
