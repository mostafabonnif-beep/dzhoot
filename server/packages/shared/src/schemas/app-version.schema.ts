import { z } from 'zod';
import {
  APP_VERSION_DISTRIBUTIONS,
  APP_VERSION_PLATFORMS,
  APP_VERSION_RELEASE_CHANNELS,
} from '../types/app-version.types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** 64 lowercase hex characters, as published next to the APK. */
export const sha256Schema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SHA256_PATTERN, 'sha256 must be 64 lowercase hex characters');

/** APK URLs are served over HTTPS only (see the update route's host allowlist). */
export const httpsUrlSchema = z
  .string()
  .trim()
  .min(1, 'downloadUrl is required')
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'downloadUrl must be a valid https URL');

export const createAppVersionSchema = z.object({
  versionName: z.string().min(1, 'Version name is required'),
  versionCode: z.number().int().positive(),
  apkFileName: z.string().min(1),
  apkFileSize: z.number().positive(),
  downloadUrl: httpsUrlSchema,
  releaseNotes: z.string().default(''),
  isActive: z.boolean().default(true),
  isMandatory: z.boolean().default(false),
  minCompatibleVersion: z.number().int().default(1),
  sha256: sha256Schema.nullish(),
  releaseChannel: z.enum(APP_VERSION_RELEASE_CHANNELS).default('stable'),
  distribution: z.enum(APP_VERSION_DISTRIBUTIONS).default('external_apk'),
  platforms: z.array(z.enum(APP_VERSION_PLATFORMS)).nullish(),
  /** Build/publish timestamp; defaults to now in the model when omitted. */
  releasedAt: z.coerce.date().optional(),
});

export const updateAppVersionSchema = createAppVersionSchema.partial();

export type CreateAppVersionInput = z.infer<typeof createAppVersionSchema>;
export type UpdateAppVersionInput = z.infer<typeof updateAppVersionSchema>;

/**
 * Accepts the version code as a number or a numeric string, and treats the empty
 * string as "not provided" so `?currentVersionCode=` does not become NaN.
 */
const optionalVersionCode = z.preprocess(
  (value) => (value === undefined || value === null || value === '' ? undefined : value),
  z.coerce
    .number()
    .int('Version code must be an integer')
    .nonnegative('Version code must be a positive integer')
    .optional(),
);

/**
 * Query contract for GET /api/v1/app/version.
 *
 * `currentVersionCode` is the documented parameter; `currentVersion` is kept as a
 * legacy alias so already-shipped clients keep working.
 */
export const appVersionQuerySchema = z
  .object({
    currentVersionCode: optionalVersionCode,
    currentVersion: optionalVersionCode,
    channel: z.enum(APP_VERSION_RELEASE_CHANNELS).default('stable'),
    platform: z.enum(APP_VERSION_PLATFORMS).default('android'),
  })
  .refine((value) => value.currentVersionCode !== undefined || value.currentVersion !== undefined, {
    message: 'Current version is required',
    path: ['currentVersionCode'],
  });

export type AppVersionQuery = z.infer<typeof appVersionQuerySchema>;
