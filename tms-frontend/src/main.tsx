import './instrument';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { router } from './routes/router';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

// Each tree installs its own ThemeProvider; only the query cache is shared.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(container).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Something went wrong. The team has been notified.</p>}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
