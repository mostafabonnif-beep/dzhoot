import '@testing-library/jest-dom';

// jsdom does not provide fetch/Response. Client components under test (e.g.
// ShopPlans) call the public API on mount, so give them a safe inert stub
// that resolves with an empty, unsuccessful payload — components then render
// their graceful fallback instead of crashing the test.
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ success: false }),
      text: () => Promise.resolve(''),
    })) as unknown as typeof fetch;
}
