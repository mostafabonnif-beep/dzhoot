import crypto from 'crypto';
import axios from 'axios';

/**
 * Chargily Pay (Algeria — EDAHABIA/CIB/Chargily App, native DZD) integration.
 *
 * Docs: https://dev.chargily.com/pay-v2/introduction
 *
 * The feature is entirely optional: when CHARGILY_SECRET_KEY is unset the
 * service reports itself as not configured and every caller degrades
 * gracefully (hide the "pay online" button, refuse checkout creation with a
 * clear error) instead of crashing the server.
 */

const LIVE_BASE_URL = 'https://pay.chargily.net/api/v2';
const TEST_BASE_URL = 'https://pay.chargily.net/test/api/v2';

export type ChargilyPaymentMethod = 'edahabia' | 'cib' | 'chargily_app';

export interface ChargilyCheckout {
  id: string;
  entity: 'checkout';
  livemode: boolean;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'canceled';
  payment_method: string | null;
  checkout_url: string;
  success_url: string;
  failure_url?: string | null;
  webhook_endpoint?: string | null;
  qr_code_url?: string;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

export interface ChargilyWebhookEvent {
  id: string;
  entity: 'event';
  livemode: boolean | string;
  type: 'checkout.paid' | 'checkout.failed' | 'checkout.canceled' | string;
  data: ChargilyCheckout;
  created_at: number;
  updated_at: number;
}

function secretKey(): string {
  return String(process.env.CHARGILY_SECRET_KEY || '').trim();
}

/** Whether an operator has configured Chargily — the "pay online" feature stays
 * hidden/disabled everywhere until this is true. */
export function isChargilyConfigured(): boolean {
  return secretKey().length > 0;
}

/** Test-mode secret keys start with "test_sk_"; live keys don't carry that prefix.
 * Chargily itself infers mode from the base URL + key pairing, but we surface
 * this so admin diagnostics can show "TEST MODE" clearly and avoid confusion. */
export function isChargilyTestMode(): boolean {
  return secretKey().startsWith('test_');
}

function baseUrl(): string {
  return isChargilyTestMode() ? TEST_BASE_URL : LIVE_BASE_URL;
}

export interface CreateCheckoutOptions {
  amount: number;
  currency?: string;
  successUrl: string;
  failureUrl?: string;
  webhookEndpoint?: string;
  description?: string;
  locale?: 'ar' | 'en' | 'fr';
  paymentMethod?: ChargilyPaymentMethod;
  metadata?: Record<string, string | number | boolean>;
}

/** Create a Chargily checkout. Throws if Chargily isn't configured or rejects the request. */
export async function createCheckout(opts: CreateCheckoutOptions): Promise<ChargilyCheckout> {
  if (!isChargilyConfigured()) {
    throw new Error('CHARGILY_NOT_CONFIGURED');
  }
  const amount = Math.round(opts.amount);
  if (!Number.isFinite(amount) || amount < 50) {
    // Chargily's practical floor is well above zero; guard against accidental
    // free/near-free checkouts from a misconfigured plan price.
    throw new Error('INVALID_AMOUNT');
  }

  const payload: Record<string, unknown> = {
    amount,
    currency: (opts.currency || 'dzd').toLowerCase(),
    success_url: opts.successUrl,
    locale: opts.locale || 'ar',
    // Merchant absorbs the Chargily fee by default so the customer pays exactly
    // the advertised plan price — matches the "price shown = price paid" promise
    // already made on /buy for the WhatsApp flow.
    chargily_pay_fees_allocation: 'merchant',
  };
  if (opts.failureUrl) payload.failure_url = opts.failureUrl;
  if (opts.webhookEndpoint) payload.webhook_endpoint = opts.webhookEndpoint;
  if (opts.description) payload.description = opts.description.slice(0, 500);
  if (opts.paymentMethod) payload.payment_method = opts.paymentMethod;
  if (opts.metadata) {
    payload.metadata = Object.entries(opts.metadata).map(([key, value]) => ({ [key]: value }));
  }

  const response = await axios.post<ChargilyCheckout>(`${baseUrl()}/checkouts`, payload, {
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });
  return response.data;
}

/** Retrieve a checkout by ID — used to reconcile status if a webhook is delayed/lost. */
export async function retrieveCheckout(checkoutId: string): Promise<ChargilyCheckout> {
  if (!isChargilyConfigured()) {
    throw new Error('CHARGILY_NOT_CONFIGURED');
  }
  const response = await axios.get<ChargilyCheckout>(`${baseUrl()}/checkouts/${encodeURIComponent(checkoutId)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
    timeout: 15_000,
  });
  return response.data;
}

/**
 * Verify a webhook's HMAC-SHA256 signature against the RAW request body.
 *
 * Per Chargily's docs, the signature is computed over the exact bytes Chargily
 * sent (before JSON parsing) using the merchant secret key. Callers MUST pass
 * the raw body string/Buffer captured before body-parsing — parsing then
 * re-stringifying can reorder keys and produce a different byte sequence,
 * causing false-negative signature failures.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined | null): boolean {
  if (!signatureHeader) return false;
  if (!isChargilyConfigured()) return false;
  const computed = crypto.createHmac('sha256', secretKey()).update(rawBody).digest('hex');
  // Constant-time comparison — guards against timing attacks on the signature check.
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(String(signatureHeader), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  isChargilyConfigured,
  isChargilyTestMode,
  createCheckout,
  retrieveCheckout,
  verifyWebhookSignature,
};
