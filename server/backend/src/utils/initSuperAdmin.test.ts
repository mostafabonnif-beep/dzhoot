jest.mock('../models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    generateChannelListCode: jest.fn(),
  },
}));

import User from '../models/User';
import { initializeSuperAdmin, isStrongProductionPassword } from './initSuperAdmin';

const mockedUser = User as unknown as {
  findOne: jest.Mock;
  generateChannelListCode: jest.Mock;
};

const managedEnvironment = [
  'NODE_ENV',
  'SUPER_ADMIN_USERNAME',
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD',
  'SUPER_ADMIN_CHANNEL_LIST_CODE',
  'FORCE_UPDATE_ADMIN_PASSWORD',
] as const;

let savedEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  jest.clearAllMocks();
  savedEnvironment = Object.fromEntries(managedEnvironment.map((key) => [key, process.env[key]]));
  delete process.env.NODE_ENV;
  delete process.env.SUPER_ADMIN_USERNAME;
  delete process.env.SUPER_ADMIN_EMAIL;
  delete process.env.SUPER_ADMIN_PASSWORD;
  delete process.env.SUPER_ADMIN_CHANNEL_LIST_CODE;
  delete process.env.FORCE_UPDATE_ADMIN_PASSWORD;
});

afterEach(() => {
  for (const key of managedEnvironment) {
    const value = savedEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('initializeSuperAdmin', () => {
  it('preserves an existing administrator and never resets credentials by default', async () => {
    const existingAdmin = {
      username: 'existing-admin',
      email: 'existing@dzhoof.local',
      password: 'existing-password-hash',
      channelListCode: 'KEEP01',
      isActive: false,
      save: jest.fn(),
    };
    mockedUser.findOne.mockResolvedValueOnce(existingAdmin);

    const result = await initializeSuperAdmin();

    expect(result).toBe(existingAdmin);
    expect(existingAdmin.password).toBe('existing-password-hash');
    expect(existingAdmin.channelListCode).toBe('KEEP01');
    expect(existingAdmin.isActive).toBe(false);
    expect(existingAdmin.save).not.toHaveBeenCalled();
  });

  it('rotates only the password when FORCE_UPDATE_ADMIN_PASSWORD is explicitly enabled', async () => {
    const existingAdmin = {
      password: 'old-password-hash',
      channelListCode: 'KEEP02',
      save: jest.fn().mockResolvedValue(undefined),
    };
    process.env.SUPER_ADMIN_PASSWORD = 'Strong!Password-For-Rotation-2026';
    process.env.FORCE_UPDATE_ADMIN_PASSWORD = 'true';
    mockedUser.findOne.mockResolvedValueOnce(existingAdmin);

    await initializeSuperAdmin();

    expect(existingAdmin.password).toBe('Strong!Password-For-Rotation-2026');
    expect(existingAdmin.channelListCode).toBe('KEEP02');
    expect(existingAdmin.save).toHaveBeenCalledTimes(1);
  });

  it('rejects weak or placeholder production credentials before querying the database', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPER_ADMIN_USERNAME = 'superadmin';
    process.env.SUPER_ADMIN_EMAIL = 'admin@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'admin123';

    await expect(initializeSuperAdmin()).rejects.toThrow('Invalid production super-admin bootstrap configuration');
    expect(mockedUser.findOne).not.toHaveBeenCalled();
  });
});

describe('isStrongProductionPassword', () => {
  it.each(['admin123', 'ChangeMeNow123!', 'password', '123456', 'aaaaaaaaaaaaaaaa'])(
    'rejects unsafe password %s',
    (password) => expect(isStrongProductionPassword(password)).toBe(false),
  );

  it('accepts a long password with at least three character classes', () => {
    expect(isStrongProductionPassword('A-Long-Unique-Password-2026')).toBe(true);
  });
});
