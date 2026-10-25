import { expect } from '@playwright/test';
import { adminUrl, test, toast } from './helpers.ts';

/**
 * The Web search page owns one config section. The fixture config has no
 * `web_search` section, so a fresh server starts with the section absent and
 * the form defaults, and each test can act independently.
 */
test.use({ signedIn: true });

interface WebSearchApiView {
  readonly config: {
    readonly enabled: boolean;
    readonly vendor?: string;
    readonly api_key_configured: boolean;
    readonly count: number;
    readonly timeout_seconds: number;
  };
  readonly vendors: readonly { readonly id: string }[];
}

test.describe('Web search settings', () => {
  test('renders the vendor form and refuses to save without a vendor', async ({ page }) => {
    await page.goto(await adminUrl('/web-search-settings'));

    await expect(page.getByText('Give the agent a search capability through one vendor.')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Enable web search' })).toBeChecked();
    await expect(page.getByText('Choose a valid vendor.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    const view = (await (await page.request.get(await adminUrl('/api/web-search/config'))).json()) as WebSearchApiView;
    expect(view.config).toMatchObject({ enabled: true, count: 5, timeout_seconds: 15 });
    expect(view.vendors.map((vendor) => vendor.id)).toEqual([
      'tavily',
      'brave',
      'exa',
      'firecrawl',
      'deepseek',
      'searxng',
      'you',
    ]);
  });

  test('saves a vendor and stores the key without echoing it', async ({ page }) => {
    await page.goto(await adminUrl('/web-search-settings'));

    await page.getByLabel('Vendor').click();
    await page.getByRole('option', { name: 'Tavily' }).click();
    await page.locator('#web-search-api-key').fill('tvly-e2e-key');
    await page.getByRole('button', { name: 'Save' }).click();

    // The shared write feedback reports the applied paths.
    await expect(toast(page, 'Applied')).toBeVisible();
    await expect(page.getByText(/A key is configured/)).toBeVisible();
    await expect(page.locator('#web-search-api-key')).toHaveValue('');

    const view = (await (await page.request.get(await adminUrl('/api/web-search/config'))).json()) as WebSearchApiView;
    expect(view.config.vendor).toBe('tavily');
    expect(view.config.api_key_configured).toBe(true);
    expect(JSON.stringify(view)).not.toContain('tvly-e2e-key');
  });

  test('a vendor without its required address is refused before the write', async ({ page }) => {
    await page.goto(await adminUrl('/web-search-settings'));

    // SearXNG has no public address, so an empty Base URL is never a default.
    await page.getByLabel('Vendor').click();
    await page.getByRole('option', { name: 'SearXNG' }).click();

    await expect(page.getByText('This vendor requires a base URL.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('a rejected write shows the configuration error', async ({ page }) => {
    await page.goto(await adminUrl('/web-search-settings'));

    // Give Brave a key, then remove it: the loader rejects that pair, and the
    // page must show the error instead of a success toast.
    await page.getByLabel('Vendor').click();
    await page.getByRole('option', { name: 'Brave Search' }).click();
    await page.locator('#web-search-api-key').fill('brave-e2e-key');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Applied')).toBeVisible();

    await page.locator('#web-search-clear-key').click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/api_key is required/)).toBeVisible();
  });
});
