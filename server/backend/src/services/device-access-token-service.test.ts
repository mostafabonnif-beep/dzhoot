const deviceFindOne = jest.fn();
const deviceUpdateOne = jest.fn();
const userFindById = jest.fn();

jest.mock('../models/Device', () => {
  const model = { findOne: deviceFindOne, updateOne: deviceUpdateOne };
  return { __esModule: true, default: model };
});
jest.mock('../models/User', () => {
  const model = { findById: userFindById };
  return { __esModule: true, default: model };
});

import {
  issueDeviceAccessToken,
  verifyDeviceAccessToken,
  revokeDeviceAccessToken,
} from './device-access-token-service';

function query(value: any) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }), exec: jest.fn().mockResolvedValue(value) }) };
}

describe('device access token service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores only a hash and rotates the previous token', async () => {
    const device: any = {
      deviceId: 'tv-1',
      accessTokenHash: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    deviceFindOne.mockReturnValue({ select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(device) }) });

    const first = await issueDeviceAccessToken('user-1', 'tv-1');
    const firstHash = device.accessTokenHash;
    const second = await issueDeviceAccessToken('user-1', 'tv-1');

    expect(first.token).toMatch(/^dzt_[A-Za-z0-9_-]{43}$/);
    expect(device.accessTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(device.accessTokenHash).not.toContain(first.token);
    expect(second.token).not.toBe(first.token);
    expect(device.accessTokenHash).not.toBe(firstHash);
    expect(device.save).toHaveBeenCalledTimes(2);
  });

  it('accepts only a non-revoked, unexpired token for an active user', async () => {
    const issuedAt = new Date();
    const device: any = {
      _id: 'device-record',
      userId: 'user-1',
      deviceId: 'tv-1',
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      accessTokenRevokedAt: null,
      accessTokenIssuedAt: issuedAt,
    };
    deviceFindOne.mockReturnValue(query(device));
    userFindById.mockReturnValue(query({ _id: 'user-1', username: 'viewer', role: 'User', isActive: true }));
    deviceUpdateOne.mockReturnValue({ catch: jest.fn() });

    const result = await verifyDeviceAccessToken(`dzt_${'a'.repeat(43)}`);

    expect(result).toMatchObject({ user: { _id: 'user-1', isActive: true }, device: { deviceId: 'tv-1' } });
    expect(deviceUpdateOne).toHaveBeenCalledWith({ _id: 'device-record' }, expect.any(Object));
  });

  it('does not expose an authorization oracle for malformed, revoked, expired, or inactive cases', async () => {
    await expect(verifyDeviceAccessToken('not-a-token')).resolves.toBeNull();

    deviceFindOne.mockReturnValue(query({
      userId: 'user-1',
      accessTokenRevokedAt: new Date(),
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    }));
    await expect(verifyDeviceAccessToken(`dzt_${'b'.repeat(43)}`)).resolves.toBeNull();

    deviceFindOne.mockReturnValue(query({
      userId: 'user-1',
      accessTokenRevokedAt: null,
      accessTokenExpiresAt: new Date(Date.now() - 1),
    }));
    await expect(verifyDeviceAccessToken(`dzt_${'c'.repeat(43)}`)).resolves.toBeNull();

    deviceFindOne.mockReturnValue(query({
      userId: 'user-1',
      accessTokenRevokedAt: null,
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    }));
    userFindById.mockReturnValue(query({ _id: 'user-1', isActive: false }));
    await expect(verifyDeviceAccessToken(`dzt_${'d'.repeat(43)}`)).resolves.toBeNull();
  });

  it('marks the current token generation revoked for a registered device', async () => {
    deviceUpdateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
    await expect(revokeDeviceAccessToken('user-1', 'tv-1')).resolves.toBe(true);
    expect(deviceUpdateOne).toHaveBeenCalledWith(
      { userId: 'user-1', deviceId: 'tv-1', accessTokenHash: { $exists: true } },
      { $set: { accessTokenRevokedAt: expect.any(Date) } },
    );
  });
});
