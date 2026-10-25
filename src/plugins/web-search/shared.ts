import Type from 'typebox';
import type { Static } from 'typebox';
import Compile from 'typebox/compile';
import type { SearchHit } from './vendor.ts';

/** Request and reply helpers every vendor adapter shares. */
export function trimmed(base: string): string {
  return base.replace(/\/+$/, '');
}

export function jsonHeaders(auth: Readonly<Record<string, string>> = {}): Record<string, string> {
  return { accept: 'application/json', 'content-type': 'application/json', ...auth };
}

export function bearer(key: string | undefined): Readonly<Record<string, string>> {
  return key === undefined ? {} : { authorization: `Bearer ${key}` };
}

export function queryUrl(base: string, path: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(`${trimmed(base)}${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return url.href;
}

const HitFields = {
  title: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  raw_content: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  snippet: Type.Optional(Type.String()),
  snippets: Type.Optional(Type.Array(Type.String())),
  date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  published_date: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  // SearXNG names the field this way.
  publishedDate: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  page_age: Type.Optional(Type.Union([Type.String(), Type.Null()])),
} as const;

const HitSchema = Type.Object(HitFields, { additionalProperties: true });

const ResultsReply = Type.Object({ results: Type.Array(HitSchema) }, { additionalProperties: true });

const BraveReply = Type.Object(
  {
    // A bare `{}` is unreadable, not an empty result set.
    web: Type.Object({ results: Type.Optional(Type.Array(HitSchema)) }, { additionalProperties: true }),
  },
  { additionalProperties: true },
);

const FirecrawlReply = Type.Object(
  {
    data: Type.Union([
      Type.Array(HitSchema),
      Type.Object({ web: Type.Optional(Type.Array(HitSchema)) }, { additionalProperties: true }),
    ]),
  },
  { additionalProperties: true },
);

const YouReply = Type.Object(
  {
    results: Type.Object(
      {
        web: Type.Optional(Type.Array(HitSchema)),
        news: Type.Optional(Type.Array(HitSchema)),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);

/** One result as the validators above allow it; derived so the fields live once. */
type HitValue = Static<typeof HitSchema>;

const validators = {
  results: Compile(ResultsReply),
  brave: Compile(BraveReply),
  firecrawl: Compile(FirecrawlReply),
  you: Compile(YouReply),
} as const;

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('invalid JSON');
  }
}

function hitsOf(rows: readonly HitValue[]): readonly SearchHit[] {
  const hits: SearchHit[] = [];
  for (const row of rows) {
    const rawUrl = typeof row.url === 'string' ? row.url : '';
    // Canonicalise the URL: a vendor could otherwise slip CR/LF and a fake
    // numbered result into the rendered list.
    if (!isHttpUrl(rawUrl)) {
      continue;
    }
    const url = new URL(rawUrl).href;
    const text = firstText(row);
    const date = row.date ?? row.published_date ?? row.publishedDate ?? row.page_age;
    hits.push({
      title: firstNonEmpty(row.title) ?? url,
      url,
      text,
      ...(typeof date === 'string' && date !== '' ? { date } : {}),
    });
  }
  return hits;
}

function firstText(row: HitValue): string {
  const snippets = Array.isArray(row.snippets) ? row.snippets.join(' ') : undefined;
  for (const candidate of [
    row.content,
    row.raw_content,
    row.text,
    row.summary,
    row.description,
    row.snippet,
    snippets,
  ]) {
    const value = firstNonEmpty(candidate);
    if (value !== undefined) {
      return value;
    }
  }
  return '';
}

function firstNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmedValue = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}

function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' && url.username === '';
}

/** The standard `{ results: [...] }` envelope (Tavily, Exa, DeepSeek, SearXNG). */
export function readResultsReply(body: string): readonly SearchHit[] {
  const payload = parseBody(body);
  if (!validators.results.Check(payload)) {
    throw new Error('missing results');
  }
  const reply = payload as Static<typeof ResultsReply>;
  return hitsOf(reply.results);
}

export function readBraveReply(body: string): readonly SearchHit[] {
  const payload = parseBody(body);
  if (!validators.brave.Check(payload)) {
    throw new Error('missing web.results');
  }
  const reply = payload as Static<typeof BraveReply>;
  return hitsOf(reply.web.results ?? []);
}

export function readFirecrawlReply(body: string): readonly SearchHit[] {
  const payload = parseBody(body);
  if (!validators.firecrawl.Check(payload)) {
    throw new Error('missing data');
  }
  const reply = payload as Static<typeof FirecrawlReply>;
  return Array.isArray(reply.data) ? hitsOf(reply.data) : hitsOf(reply.data.web ?? []);
}

export function readYouReply(body: string): readonly SearchHit[] {
  const payload = parseBody(body);
  if (!validators.you.Check(payload)) {
    throw new Error('missing results');
  }
  const reply = payload as Static<typeof YouReply>;
  return hitsOf([...(reply.results.web ?? []), ...(reply.results.news ?? [])]);
}
