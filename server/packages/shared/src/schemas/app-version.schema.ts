import { z } from 'zod';

export const createAppVersionSchema = z.object({
  versionName: z.string().min(1, 'Version name is required'),
  versionCode: z.number().int().positive(),
  apkFileName: z.string().min(1),
  apkFileSize: z.number().positive(),
  downloadUrl: z.string().min(1),
  releaseNotes: z.string().default(''),
  isActive: z.boolean().default(true),
  isMandatory: z.boolean().default(false),
  minCompatibleVersion: z.number().int().default(1),
});

export const updateAppVersionSchema = createAppVersionSchema.partial();

export type CreateAppVersionInput = z.infer<typeof createAppVersionSchema>;
export type UpdateAppVersionInput = z.infer<typeof updateAppVersionSchema>;

/**
 * Release channels a client can ask about. A version whose document predates the
 * channel field is treated as `stable` (see the update route).
 */
export const APP_VERSION_CHANNELS = ['stable', 'beta'] as const;

/** Client platforms the update route accepts. `fire-tv` is normalised to android-tv. */
export const APP_VERSION_PLATFORMS = ['android', 'android-tv', 'android-mobile', 'fire-tv'] as const;

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
    channel: z.enum(APP_VERSION_CHANNELS).default('stable'),
    platform: z.enum(APP_VERSION_PLATFORMS).default('android'),
  })
  .refine((value) => value.currentVersionCode !== undefined || value.currentVersion !== undefined, {
    message: 'Current version is required',
    path: ['currentVersionCode'],
  });

export type AppVersionQuery = z.infer<typeof appVersionQuerySchema>;
