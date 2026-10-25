import { expect, test } from 'vitest';
import { join } from 'node:path';
import { readConfigRevision } from '../src/adapters/local-monolith/config-file.ts';
import { ConfigReloader } from '../src/adapters/local-monolith/config-reload.ts';
import { AdminServer } from '../src/ingress/admin/server.ts';
import { AgentModelSwitcher } from '../src/platform/model-switch.ts';
import { SecretStore } from '../src/platform/secrets.ts';
import { fixture, PASSWORD, post, readJson, request, sessionCookie } from './admin-fixtures.ts';

test('web-search config reads, writes and hot-applies', async () => {
  const { store, loaded, configStore, directory } = await fixture();
  const configPath = join(directory, 'config.jsonc');
  const secrets = new SecretStore();
  const configReloader = new ConfigReloader({
    loaded,
    store: configStore,
    modelSwitcher: new AgentModelSwitcher(configStore),
    secrets,
    validateAgentModel: () => undefined,
    onPublished: () => undefined,
  });
  const server = new AdminServer({ store, configStore, configReloader });
  try {
    const setup = await server.handle(post('/api/auth/setup', { username: 'owner', password: PASSWORD }));
    const cookie = sessionCookie(setup);
    let revision = await readConfigRevision(configPath);
    const put = (body: unknown): Request =>
      request('/api/web-search/config', {
        method: 'PUT',
        headers: { cookie, 'if-match': revision, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const initial = await readJson(await server.handle(request('/api/web-search/config', { headers: { cookie } })));
    expect(initial.config).toMatchObject({ enabled: true, count: 5, timeout_seconds: 15 });
    expect(initial.vendors.map((vendor: { id: string }) => vendor.id)).toEqual([
      'tavily',
      'brave',
      'exa',
      'firecrawl',
      'deepseek',
      'searxng',
      'you',
    ]);

    // No If-Match: refused before the file is touched.
    const missing = await server.handle(
      request('/api/web-search/config', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(missing.status).toBe(400);

    const written = await server.handle(put({ vendor: 'tavily', api_key: 'tvly-test', count: 3 }));
    const body = await readJson(written);
    expect(written.status).toBe(200);
    expect(body.config).toMatchObject({ vendor: 'tavily', api_key_configured: true, count: 3 });
    // The plaintext never comes back, and the write is already live.
    expect(JSON.stringify(body)).not.toContain('tvly-test');
    expect(configStore.current().config.web_search).toMatchObject({ vendor: 'tavily', count: 3 });

    // Removing the key while the vendor requires one is a configuration error,
    // and a rejected write leaves the file untouched.
    revision = await readConfigRevision(configPath);
    expect((await server.handle(put({ api_key: null }))).status).toBe(422);
    expect(await readConfigRevision(configPath)).toBe(revision);

    // The keyless vendor accepts the same clear.
    revision = await readConfigRevision(configPath);
    expect((await server.handle(put({ vendor: 'you' }))).status).toBe(200);
    revision = await readConfigRevision(configPath);
    const cleared = await readJson(await server.handle(put({ api_key: null })));
    expect(cleared.config.api_key_configured).toBe(false);

    // A base URL override round-trips: set, then remove.
    revision = await readConfigRevision(configPath);
    const setBase = await readJson(await server.handle(put({ base_url: 'https://search.example' })));
    expect(setBase.config.base_url).toBe('https://search.example');
    revision = await readConfigRevision(configPath);
    const removed = await readJson(await server.handle(put({ base_url: null })));
    expect(removed.config.base_url).toBeUndefined();

    // Repeating the same values is a no-op: the file is not rewritten.
    revision = await readConfigRevision(configPath);
    const idempotent = await readJson(await server.handle(put({ vendor: 'you' })));
    expect(idempotent.apply.applied).toEqual([]);
    expect(await readConfigRevision(configPath)).toBe(revision);

    // Unknown fields, vendors and out-of-range numbers never reach the file.
    revision = await readConfigRevision(configPath);
    expect((await server.handle(put({ enable: true }))).status).toBe(400);
    revision = await readConfigRevision(configPath);
    expect((await server.handle(put({ vendor: 'nope' }))).status).toBe(400);
    revision = await readConfigRevision(configPath);
    expect((await server.handle(put({ count: 11 }))).status).toBe(400);

    // A stale revision is a conflict, not a silent overwrite.
    const staleRevision = await readConfigRevision(configPath);
    revision = staleRevision;
    expect((await server.handle(put({ timeout_seconds: 20 }))).status).toBe(200);
    const conflicted = await server.handle(
      request('/api/web-search/config', {
        method: 'PUT',
        headers: { cookie, 'if-match': staleRevision, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(conflicted.status).toBe(409);
  } finally {
    await server.stop();
  }
});
