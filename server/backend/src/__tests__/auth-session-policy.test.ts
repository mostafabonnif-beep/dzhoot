const { router, buildOwnedOtherSessionsFilter } = require('../routes/auth');

describe('session revocation authorization', () => {
  it('builds a filter scoped to the authenticated user and preserves the current session', () => {
    expect(buildOwnedOtherSessionsFilter('user-123', 'session-current')).toEqual({
      userId: 'user-123',
      sessionId: { $ne: 'session-current' },
    });
  });

  it('allows the revoke-other-sessions route with authentication only', () => {
    const layer = router.stack.find(
      (entry: any) => entry.route?.path === '/revoke-other-sessions' && entry.route?.methods?.post,
    );
    expect(layer).toBeDefined();

    const middlewareNames = layer.route.stack.map((entry: any) => entry.handle.name);
    expect(middlewareNames).toContain('requireAuth');
    expect(middlewareNames).not.toContain('requireAdmin');
  });
});
