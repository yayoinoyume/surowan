import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { errorMessage } from '@/lib/errors';
import { webSearchQuery } from '@/lib/queries';
import { useProviderWrite } from '@/lib/use-provider-write';
import { type WebSearchConfigView, type WebSearchUpdate, updateWebSearchConfig } from '@/lib/api/web-search.ts';

interface Draft {
  readonly enabled: boolean;
  readonly vendor: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly clearApiKey: boolean;
  readonly count: string;
  readonly timeoutSeconds: string;
}

function draftFrom(view: WebSearchConfigView): Draft {
  return {
    enabled: view.config.enabled,
    vendor: view.config.vendor ?? '',
    baseUrl: view.config.base_url ?? '',
    apiKey: '',
    clearApiKey: false,
    count: String(view.config.count),
    timeoutSeconds: String(view.config.timeout_seconds),
  };
}

export default function WebSearchSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery(webSearchQuery);
  const write = useProviderWrite();
  // `edited` holds only local changes; the server view is the source of truth
  // until the operator touches a field.
  const [edited, setEdited] = useState<Draft | undefined>(undefined);
  const current = settings.data;
  const draft = edited ?? (current === undefined ? undefined : draftFrom(current));
  const update = (patch: Partial<Draft>): void => {
    if (draft !== undefined) {
      setEdited({ ...draft, ...patch });
    }
  };

  const save = useMutation({
    mutationFn: ({ body, revision }: { body: WebSearchUpdate; revision: string }) =>
      updateWebSearchConfig(body, revision),
    onSuccess: (result) => {
      queryClient.setQueryData(webSearchQuery.queryKey, result);
      setEdited(undefined);
      write.succeeded(result.apply);
    },
    onError: write.failed,
  });

  const submit = (): void => {
    if (draft === undefined || current === undefined) {
      return;
    }
    const body: WebSearchUpdate = {
      enabled: draft.enabled,
      count: Number(draft.count),
      timeout_seconds: Number(draft.timeoutSeconds),
      ...(draft.vendor === '' ? {} : { vendor: draft.vendor }),
      // An empty field means "use the vendor default", which is a removal.
      ...(draft.baseUrl.trim() === '' ? { base_url: null } : { base_url: draft.baseUrl.trim() }),
      ...(draft.clearApiKey ? { api_key: null } : draft.apiKey === '' ? {} : { api_key: draft.apiKey }),
    };
    save.mutate({ body, revision: current.revision });
  };

  const needsVendor = draft?.enabled === true && draft.vendor === '';
  const selectedVendor = current?.vendors.find((vendor) => vendor.id === draft?.vendor);
  // SearXNG has no public address, so an empty field is not a valid default.
  // A disabled section is a placeholder the loader accepts, so only check
  // while the switch is on.
  const needsBaseUrl =
    draft?.enabled === true && selectedVendor?.needs_base_url === true && (draft?.baseUrl ?? '').trim() === '';

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('pages.webSearch.title')}</CardTitle>
          <CardDescription>{t('pages.webSearch.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {settings.isPending ? (
            <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : settings.isError || draft === undefined || current === undefined ? (
            <p role="alert" className="text-destructive text-sm break-words">
              {settings.isError ? errorMessage(settings.error) : t('pages.webSearch.loadFailed')}
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="web-search-enabled">{t('pages.webSearch.enable')}</Label>
                  <p className="text-muted-foreground text-sm">{t('pages.webSearch.enableDescription')}</p>
                  <p className="text-muted-foreground text-xs">{t('pages.webSearch.contextNote')}</p>
                </div>
                <Switch
                  id="web-search-enabled"
                  checked={draft.enabled}
                  disabled={save.isPending}
                  onCheckedChange={(enabled) => update({ enabled })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="web-search-vendor">{t('pages.webSearch.vendor')}</Label>
                <Select value={draft.vendor} disabled={save.isPending} onValueChange={(vendor) => update({ vendor })}>
                  <SelectTrigger id="web-search-vendor" className="w-full">
                    <SelectValue placeholder={t('pages.webSearch.vendorPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {current.vendors.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">{t('pages.webSearch.vendorDescription')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="web-search-base-url">{t('pages.webSearch.baseUrl')}</Label>
                <Input
                  id="web-search-base-url"
                  value={draft.baseUrl}
                  disabled={save.isPending}
                  placeholder={selectedVendor?.default_base_url ?? ''}
                  onChange={(event) => update({ baseUrl: event.target.value })}
                />
                <p className="text-muted-foreground text-sm">{t('pages.webSearch.baseUrlDescription')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="web-search-api-key">{t('pages.webSearch.apiKey')}</Label>
                <Input
                  id="web-search-api-key"
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  disabled={save.isPending || draft.clearApiKey}
                  placeholder={t('pages.webSearch.apiKeyPlaceholder')}
                  onChange={(event) => update({ apiKey: event.target.value })}
                />
                <p className="text-muted-foreground text-sm">
                  {current.config.api_key_configured
                    ? t('pages.webSearch.apiKeyConfigured')
                    : t('pages.webSearch.apiKeyMissing')}
                </p>
                <p className="text-muted-foreground text-sm">{t('pages.webSearch.apiKeyDescription')}</p>
                {current.config.api_key_configured ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="web-search-clear-key"
                      checked={draft.clearApiKey}
                      disabled={save.isPending}
                      onCheckedChange={(clearApiKey) => update({ clearApiKey })}
                    />
                    <Label htmlFor="web-search-clear-key">{t('pages.webSearch.clearApiKey')}</Label>
                  </div>
                ) : undefined}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="web-search-count">{t('pages.webSearch.count')}</Label>
                  <Input
                    id="web-search-count"
                    type="number"
                    min={1}
                    max={10}
                    value={draft.count}
                    disabled={save.isPending}
                    onChange={(event) => update({ count: event.target.value })}
                  />
                  <p className="text-muted-foreground text-sm">{t('pages.webSearch.countDescription')}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="web-search-timeout">{t('pages.webSearch.timeout')}</Label>
                  <Input
                    id="web-search-timeout"
                    type="number"
                    min={5}
                    max={30}
                    value={draft.timeoutSeconds}
                    disabled={save.isPending}
                    onChange={(event) => update({ timeoutSeconds: event.target.value })}
                  />
                  <p className="text-muted-foreground text-sm">{t('pages.webSearch.timeoutDescription')}</p>
                </div>
              </div>

              {needsVendor ? (
                <p role="alert" className="text-destructive text-sm">
                  {t('pages.webSearch.vendorRequired')}
                </p>
              ) : undefined}
              {needsBaseUrl ? (
                <p role="alert" className="text-destructive text-sm">
                  {t('pages.webSearch.baseUrlRequired')}
                </p>
              ) : undefined}
              {save.isError ? (
                <p role="alert" className="text-destructive text-sm break-words">
                  {errorMessage(save.error)}
                </p>
              ) : undefined}

              <Button onClick={submit} disabled={save.isPending || needsVendor || needsBaseUrl}>
                {save.isPending ? t('pages.webSearch.saving') : t('pages.webSearch.save')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
