/**
 * Sentry has to be initialised before the app renders, so `main.tsx` imports
 * this module first. Without VITE_SENTRY_DSN the SDK stays inert.
 */
import { useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom';

const dsn = import.meta.env.VITE_SENTRY_DSN;

// Replay starts recording inside Sentry.init — before React can strip the query — and its
// envelopes bypass beforeSend, so a landing URL with a token must never be recorded at all.
const carriesToken = new URLSearchParams(window.location.search).has('token');

const stripQuery = (url: string) => url.split(/[?#]/)[0];

/**
 * Strips query and fragment from the URL fields of error and transaction events, so a
 * reset or invitation token cannot ride along on one.
 */
function scrubUrls<T extends Sentry.Event>(event: T): T {
  if (event.request?.url) {
    event.request.url = stripQuery(event.request.url);
  }

  delete event.request?.query_string;

  if (event.request?.headers?.Referer) {
    event.request.headers.Referer = stripQuery(event.request.headers.Referer);
  }

  // Browser tracing records the location on the root span, which is copied into contexts.trace,
  // and the fetch instrumentation keeps the raw query in a separate attribute.
  for (const data of [event.contexts?.trace?.data, ...(event.spans ?? []).map((s) => s.data)]) {
    if (typeof data?.['url.full'] === 'string') {
      data['url.full'] = stripQuery(data['url.full']);
    }

    delete data?.['http.query'];
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    for (const key of ['from', 'to', 'url'] as const) {
      if (typeof breadcrumb.data?.[key] === 'string') {
        breadcrumb.data[key] = stripQuery(breadcrumb.data[key]);
      }
    }
  }

  return event;
}

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_SENTRY_RELEASE,
  integrations: [
    Sentry.reactRouterV7BrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
    ...(carriesToken
      ? []
      : [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })]),
  ],
  tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  sendDefaultPii: false,
  beforeSend: scrubUrls,
  beforeSendTransaction: scrubUrls,
});
