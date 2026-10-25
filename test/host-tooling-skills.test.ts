import { expect, test } from 'vitest';
import type { SystemSkill } from '../src/platform/system-resources.ts';
import { playgroundImageFixture } from './playground-image-fixtures.ts';

const WEB_SEARCH_SKILL: SystemSkill = {
  name: 'web-search',
  description: '',
  uri: 'system:///skills/web-search/SKILL.md',
};

const WEB_FETCH_SKILL: SystemSkill = {
  name: 'web-fetch',
  description: '',
  uri: 'system:///skills/web-fetch/SKILL.md',
};

test('the host applies a plugin skill visibility condition', async () => {
  const f = await playgroundImageFixture();
  const target = { hostKind: 'playground' as const, conversationId: f.room.conversationId };

  // Unconfigured: the plugin hides its skill, and an unconditional one stays.
  expect(f.tooling.skillVisible(WEB_SEARCH_SKILL, target)).toBe(false);
  expect(f.tooling.skillVisible(WEB_FETCH_SKILL, target)).toBe(true);

  const current = f.configStore.current();
  f.configStore.publish({
    ...current,
    config: { ...current.config, web_search: { vendor: 'tavily', api_key: { env: 'TAVILY_KEY' } } },
  });
  expect(f.tooling.skillVisible(WEB_SEARCH_SKILL, target)).toBe(true);
});
