import * as Sentry from '@sentry/nextjs';

export const onRequestError = Sentry.captureRequestError;

export async function register() {
  Sentry.init({
    dsn: process.env.FRONTEND_SENTRY_DSN,
    tracesSampleRate: 0.1,
    enabled: !!process.env.FRONTEND_SENTRY_DSN,
  });
}
