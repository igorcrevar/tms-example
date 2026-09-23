/**
 * Sentry must be initialised before any other module is imported so that its
 * auto-instrumentation can patch the libraries Nest loads. `main.ts` imports
 * this file first; nothing else should be imported above it.
 */
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

import { AppConfig } from './config/app-config';

const { app, sentry } = AppConfig.load(process.env);

Sentry.init({
  dsn: sentry.dsn,
  // Without a DSN the SDK stays inert, which is what we want locally.
  enabled: Boolean(sentry.dsn),
  environment: app.env,
  release: sentry.release || undefined,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: sentry.tracesSampleRate,
  profilesSampleRate: sentry.profilesSampleRate,
  sendDefaultPii: false,
  // A 5xx during login or 2FA would otherwise ship the password, code or PIN.
  beforeSend(event) {
    delete event.request?.data;

    return event;
  },
});
