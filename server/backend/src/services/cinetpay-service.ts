import axios from 'axios';

/**
 * CinetPay checkout integration (mobile money + cards, CFA-franc regions).
 *
 * Docs: https://docs.cinetpay.com/api/checkout
 *
 * Entirely optional second gateway beside Chargily: when CINETPAY_API_KEY and
 * CINETPAY_SITE_ID are unset the service reports itself as not configured and
 * every caller degrades gracefully (hide the "pay online" button, refuse
 * checkout creation with a clear error) instead of crashing the server.
 *
 * Security model: webhook notifications are never trusted on their own — the
 * transaction is re-verified against CinetPay's server-side
 * /v2/payment/check endpoint (their documented verification flow) before any
 * fulfillment happens.
 */

const CHECKOUT_BASE_URL = 'https://api-checkout.cinetpay.com/v2';

function apiKey(): string {
  return String(process.env.CINETPAY_API_KEY || '').trim();
}

function siteId(): string {
  return String(process.env.CINETPAY_SITE_ID || '').trim();
}

/** Whether an operator has configured CinetPay — the feature stays hidden
 * everywhere until this is true. */
export function isCinetpayConfigured(): boolean {
  return apiKey().length > 0 && siteId().length > 0;
}

export interface CinetpayCheckout {
  /** Opaque checkout token (payment_token). */
  payment_token: string;
  /** Hosted payment page URL the customer must be redirected to. */
  payment_url: string;
  status?: string | null;
  [key: string]: unknown;
}

export interface CinetpayCheckResult {
  /** CinetPay's transaction status: ACCEPTED / REFUSED / ... */
  status: string | null;
  amount?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  [key: string]: unknown;
}

export interface CreateCinetpayCheckoutOptions {
  /** Unique transaction id (we use the payment's unguessable public token). */
  transactionId: string;
  amount: number;
  currency: string;
  description?: string;
  notifyUrl: string;
  returnUrl: string;
  customerPhone?: string | null;
  metadata?: Record<string, string | number>;
}

function authPayload(): Record<string, string> {
  return { api_key: apiKey(), site_id: siteId() };
}

/** Create a CinetPay checkout. Throws CINETPAY_NOT_CONFIGURED / INVALID_AMOUNT
 * or propagates the upstream error. */
export async function createCinetpayCheckout(
  opts: CreateCinetpayCheckoutOptions,
): Promise<CinetpayCheckout> {
  if (!isCinetpayConfigured()) {
    throw new Error('CINETPAY_NOT_CONFIGURED');
  }
  const amount = Math.round(opts.amount);
  if (!Number.isFinite(amount) || amount < 50) {
    throw new Error('INVALID_AMOUNT');
  }

  const payload: Record<string, unknown> = {
    ...authPayload(),
    transaction_id: String(opts.transactionId).slice(0, 50),
    amount,
    currency: String(opts.currency || 'XOF').toUpperCase(),
    description: String(opts.description || 'Order').slice(0, 254),
    notify_url: opts.notifyUrl,
    return_url: opts.returnUrl,
    // ALL = let the customer pick mobile money or card on CinetPay's page.
    channels: 'ALL',
    lang: 'fr',
  };
  if (opts.customerPhone) payload.customer_phone_number = String(opts.customerPhone);
  if (opts.metadata) payload.metadata = JSON.stringify(opts.metadata);

  const response = await axios.post(`${CHECKOUT_BASE_URL}/payment`, payload, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 15_000,
  });
  const body = response.data || {};
  if (body.code !== '00' || !body.data?.payment_url) {
    throw new Error(`CINETPAY_ERROR_${body.code || 'UNKNOWN'}`);
  }
  return body.data as CinetpayCheckout;
}

/** Re-verify a transaction against CinetPay's server (source of truth). */
export async function checkCinetpayTransaction(transactionId: string): Promise<CinetpayCheckResult> {
  if (!isCinetpayConfigured()) {
    throw new Error('CINETPAY_NOT_CONFIGURED');
  }
  const response = await axios.post(
    `${CHECKOUT_BASE_URL}/payment/check`,
    { ...authPayload(), transaction_id: String(transactionId).slice(0, 50) },
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15_000 },
  );
  const body = response.data || {};
  if (body.code !== '00') {
    throw new Error(`CINETPAY_CHECK_ERROR_${body.code || 'UNKNOWN'}`);
  }
  const data = body.data || {};
  return {
    status: data.status ?? null,
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    payment_method: data.payment_method ?? null,
    ...data,
  };
}

/** Map CinetPay's statuses onto the platform's PaymentStatus values.
 * Unknown/missing statuses map to null so callers keep the current state. */
export function mapCinetpayStatus(status: string | null | undefined): 'paid' | 'failed' | 'canceled' | null {
  const s = String(status || '').toUpperCase();
  if (s === 'ACCEPTED') return 'paid';
  if (s === 'REFUSED') return 'failed';
  if (s === 'CANCELLED' || s === 'CANCELED') return 'canceled';
  return null;
}

module.exports = {
  isCinetpayConfigured,
  createCinetpayCheckout,
  checkCinetpayTransaction,
  mapCinetpayStatus,
};
