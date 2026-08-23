import User from '../models/User';
import { IUserDocument } from '@dzhoof/shared';

const BLOCKED_PRODUCTION_PASSWORDS = new Set([
  'admin123',
  'changeme',
  'change-me',
  'change_me',
  'password',
  'password123',
  '123456',
  '12345678',
  'changemenow123!',
  'superadmin',
]);

function isStrongProductionPassword(value: string): boolean {
  const password = String(value || '');
  const normalized = password.trim().toLowerCase();
  if (password.length < 16 || password !== password.trim() || BLOCKED_PRODUCTION_PASSWORDS.has(normalized)) {
    return false;
  }
  if (/change[-_]?me|placeholder|example|your[-_]?password/i.test(password)) return false;
  if (/^(.)\1+$/.test(password) || /(.)\1{5,}/.test(password)) return false;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((matcher) => matcher.test(password));
  return classes.length >= 3;
}

function assertProductionBootstrapConfiguration(): void {
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const username = String(process.env.SUPER_ADMIN_USERNAME || '').trim();
  if (!isStrongProductionPassword(password) || !username || !email || email.includes('example.com')) {
    throw new Error(
      'Invalid production super-admin bootstrap configuration. Set strong non-placeholder credentials before startup.',
    );
  }
}

/**
 * Create the initial super-admin account only when no administrator exists.
 *
 * A running production instance must never silently reset an administrator's
 * password, identity, device code, or active state. Password rotation is an
 * explicit break-glass operation enabled only with FORCE_UPDATE_ADMIN_PASSWORD.
 */
async function initializeSuperAdmin(): Promise<IUserDocument> {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const email = process.env.SUPER_ADMIN_EMAIL || 'admin@dzhoof.local';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMeNow123!';

    if (isProduction) assertProductionBootstrapConfiguration();

    const configuredAdmin = await User.findOne({
      $or: [{ username }, { email }],
    });
    const existingAdmin = configuredAdmin || (await User.findOne({ role: 'Admin' }));

    if (existingAdmin) {
      if (process.env.FORCE_UPDATE_ADMIN_PASSWORD === 'true') {
        if (isProduction) assertProductionBootstrapConfiguration();
        existingAdmin.password = password;
        await existingAdmin.save();
        console.log('Super-admin password rotation completed by explicit request');
      } else {
        console.log('Existing super-admin preserved; bootstrap did not alter credentials');
      }
      return existingAdmin;
    }

    const channelListCode =
      process.env.SUPER_ADMIN_CHANNEL_LIST_CODE || (await (User as any).generateChannelListCode());
    const superAdmin = new User({
      username,
      password,
      email,
      emailVerified: true,
      role: 'Admin',
      isActive: true,
      channelListCode,
    });

    await superAdmin.save();
    console.log('Initial super-admin account created');
    return superAdmin;
  } catch (error) {
    console.error('Super-admin bootstrap failed:', (error as Error).message);
    throw error;
  }
}

module.exports = {
  initializeSuperAdmin,
  isStrongProductionPassword,
  assertProductionBootstrapConfiguration,
};
export { initializeSuperAdmin, isStrongProductionPassword, assertProductionBootstrapConfiguration };
