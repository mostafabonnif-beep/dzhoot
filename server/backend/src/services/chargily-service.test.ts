import crypto from 'crypto';
import axios from 'axios';
import {
  isChargilyConfigured,
  isChargilyTestMode,
  createCheckout,
  retrieveCheckout,
  verifyWebhookSignature,
} from './chargily-service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('chargily-service', () => {
  const originalKey = process.env.CHARGILY_SECRET_KEY;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalKey === undefined) delete process.env.CHARGILY_SECRET_KEY;
    else process.env.CHARGILY_SECRET_KEY = originalKey;
  });

  describe('isChargilyConfigured / isChargilyTestMode', () => {
    it('reports not configured when no secret key is set', () => {
      delete process.env.CHARGILY_SECRET_KEY;
      expect(isChargilyConfigured()).toBe(false);
    });

    it('reports configured + test mode for a test_ prefixed key', () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      expect(isChargilyConfigured()).toBe(true);
      expect(isChargilyTestMode()).toBe(true);
    });

    it('reports live mode for a non-test-prefixed key', () => {
      process.env.CHARGILY_SECRET_KEY = 'sk_live_abc123';
      expect(isChargilyTestMode()).toBe(false);
    });
  });

  describe('createCheckout', () => {
    it('throws CHARGILY_NOT_CONFIGURED when no secret key is set', async () => {
      delete process.env.CHARGILY_SECRET_KEY;
      await expect(
        createCheckout({ amount: 5000, successUrl: 'https://x.test/ok' }),
      ).rejects.toThrow('CHARGILY_NOT_CONFIGURED');
    });

    it('rejects an implausibly small amount before calling the API', async () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      await expect(
        createCheckout({ amount: 1, successUrl: 'https://x.test/ok' }),
      ).rejects.toThrow('INVALID_AMOUNT');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('posts to the TEST base URL with a Bearer header for a test_ key', async () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 'chk_1', status: 'pending', checkout_url: 'https://pay.chargily.dz/test/checkouts/chk_1/pay' },
      });

      const result = await createCheckout({
        amount: 5000,
        successUrl: 'https://x.test/success',
        failureUrl: 'https://x.test/failure',
        webhookEndpoint: 'https://x.test/webhook',
        description: 'Monthly plan',
        metadata: { planId: 'plan123' },
      });

      expect(result.checkout_url).toContain('/pay');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = mockedAxios.post.mock.calls[0];
      expect(url).toBe('https://pay.chargily.net/test/api/v2/checkouts');
      expect(body).toMatchObject({
        amount: 5000,
        currency: 'dzd',
        success_url: 'https://x.test/success',
        failure_url: 'https://x.test/failure',
        webhook_endpoint: 'https://x.test/webhook',
        chargily_pay_fees_allocation: 'merchant',
      });
      expect((config as any)?.headers?.Authorization).toBe('Bearer test_sk_abc123');
    });

    it('posts to the LIVE base URL for a non-test key', async () => {
      process.env.CHARGILY_SECRET_KEY = 'sk_live_abc123';
      mockedAxios.post.mockResolvedValueOnce({ data: { id: 'chk_2', status: 'pending', checkout_url: 'https://pay.chargily.dz/checkouts/chk_2/pay' } });

      await createCheckout({ amount: 2000, successUrl: 'https://x.test/success' });

      const [url] = mockedAxios.post.mock.calls[0];
      expect(url).toBe('https://pay.chargily.net/api/v2/checkouts');
    });

    it('rounds fractional amounts', async () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      mockedAxios.post.mockResolvedValueOnce({ data: { id: 'chk_3', status: 'pending', checkout_url: 'https://x/pay' } });
      await createCheckout({ amount: 1999.6, successUrl: 'https://x.test/success' });
      const [, body] = mockedAxios.post.mock.calls[0];
      expect((body as any).amount).toBe(2000);
    });
  });

  describe('retrieveCheckout', () => {
    it('throws when not configured', async () => {
      delete process.env.CHARGILY_SECRET_KEY;
      await expect(retrieveCheckout('chk_1')).rejects.toThrow('CHARGILY_NOT_CONFIGURED');
    });

    it('GETs the checkout by id with a Bearer header', async () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      mockedAxios.get.mockResolvedValueOnce({ data: { id: 'chk_1', status: 'paid' } });
      const result = await retrieveCheckout('chk_1');
      expect(result.status).toBe('paid');
      const [url, config] = mockedAxios.get.mock.calls[0];
      expect(url).toBe('https://pay.chargily.net/test/api/v2/checkouts/chk_1');
      expect((config as any)?.headers?.Authorization).toBe('Bearer test_sk_abc123');
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns false when Chargily is not configured', () => {
      delete process.env.CHARGILY_SECRET_KEY;
      expect(verifyWebhookSignature('{}', 'anything')).toBe(false);
    });

    it('returns false when no signature header is provided', () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      expect(verifyWebhookSignature('{}', undefined)).toBe(false);
      expect(verifyWebhookSignature('{}', null)).toBe(false);
      expect(verifyWebhookSignature('{}', '')).toBe(false);
    });

    it('returns true for a correctly computed HMAC-SHA256 signature over the raw body', () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      const rawBody = JSON.stringify({ id: 'evt_1', type: 'checkout.paid', data: { id: 'chk_1' } });
      const signature = crypto.createHmac('sha256', 'test_sk_abc123').update(rawBody).digest('hex');
      expect(verifyWebhookSignature(rawBody, signature)).toBe(true);
    });

    it('returns false when the signature does not match (tampered payload)', () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      const rawBody = JSON.stringify({ id: 'evt_1', type: 'checkout.paid' });
      const signature = crypto.createHmac('sha256', 'test_sk_abc123').update(rawBody).digest('hex');
      const tamperedBody = JSON.stringify({ id: 'evt_1', type: 'checkout.failed' });
      expect(verifyWebhookSignature(tamperedBody, signature)).toBe(false);
    });

    it('returns false when signed with the wrong secret key', () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_correct';
      const rawBody = JSON.stringify({ id: 'evt_1' });
      const signature = crypto.createHmac('sha256', 'test_sk_WRONG').update(rawBody).digest('hex');
      expect(verifyWebhookSignature(rawBody, signature)).toBe(false);
    });

    it('handles a Buffer raw body identically to the equivalent string', () => {
      process.env.CHARGILY_SECRET_KEY = 'test_sk_abc123';
      const rawBody = JSON.stringify({ id: 'evt_1' });
      const signature = crypto.createHmac('sha256', 'test_sk_abc123').update(rawBody).digest('hex');
      expect(verifyWebhookSignature(Buffer.from(rawBody, 'utf8'), signature)).toBe(true);
    });
  });
});
