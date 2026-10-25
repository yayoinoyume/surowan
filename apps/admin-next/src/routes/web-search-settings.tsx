import { createFileRoute } from '@tanstack/react-router';
import WebSearchSettingsPage from '@/pages/web-search-settings';

export const Route = createFileRoute('/web-search-settings')({
  component: WebSearchSettingsPage,
});
