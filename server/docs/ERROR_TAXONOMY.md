# DZ HOOF — Error Taxonomy

_Generated from `server/packages/shared/src/errors/error-codes.ts` — edit the registry,
not this table._

Every failure reported by the app, the update pipeline or the API carries a stable code
from this registry instead of free text, so retry/rollback/UI decisions never depend on
parsing message strings (operations brief §11).

## Fields

Each definition provides:

| Field | Meaning |
|---|---|
| `userMessageKey` | i18n key the client resolves to a user-facing (Arabic-first) message. |
| `developerMessage` | Non-sensitive explanation for logs and developers. |
| `retryable` | Whether repeating the same operation can plausibly succeed. |
| `severity` | `warn` \| `error` \| `fatal`. |
| `feature` | `update` \| `auth` \| `pairing` \| `catalog` \| `epg` \| `playback` \| `cache` \| `api`. |
| `remediation` | What the user or operator should do about it. |

At runtime `buildErrorReport(code, { correlationId, httpStatus, durationMs, details })`
adds the correlation id and the observed values. `details` is flat and primitive-only so
an object with credentials can never be attached by accident. Definitions and reports are
non-sensitive by construction: no URLs, no credentials, no user identifiers.

## Codes

| Code | Feature | Severity | Retryable | userMessageKey |
|---|---|---|---|---|
| `UPDATE_CHECK_NETWORK` | update | warn | yes | `errors.update.update_check_network` |
| `UPDATE_METADATA_INVALID` | update | error | no | `errors.update.update_metadata_invalid` |
| `UPDATE_NOT_SUPPORTED` | update | warn | no | `errors.update.update_not_supported` |
| `UPDATE_DOWNLOAD_FAILED` | update | warn | yes | `errors.update.update_download_failed` |
| `UPDATE_CHECKSUM_MISMATCH` | update | error | yes | `errors.update.update_checksum_mismatch` |
| `UPDATE_SIGNATURE_MISMATCH` | update | error | no | `errors.update.update_signature_mismatch` |
| `UPDATE_PACKAGE_MISMATCH` | update | error | no | `errors.update.update_package_mismatch` |
| `UPDATE_DOWNGRADE_BLOCKED` | update | warn | no | `errors.update.update_downgrade_blocked` |
| `UPDATE_USER_ACTION_REQUIRED` | update | warn | yes | `errors.update.update_user_action_required` |
| `UPDATE_STORAGE_INSUFFICIENT` | update | warn | yes | `errors.update.update_storage_insufficient` |
| `UPDATE_INSTALL_FAILED` | update | error | yes | `errors.update.update_install_failed` |
| `UPDATE_ROLLBACK_REQUIRED` | update | fatal | no | `errors.update.update_rollback_required` |
| `AUTH_SESSION_EXPIRED` | auth | warn | no | `errors.auth.auth_session_expired` |
| `PAIRING_EXPIRED` | pairing | warn | yes | `errors.pairing.pairing_expired` |
| `CATALOG_SYNC_FAILED` | catalog | error | yes | `errors.catalog.catalog_sync_failed` |
| `EPG_SYNC_FAILED` | epg | warn | yes | `errors.epg.epg_sync_failed` |
| `PLAYBACK_SOURCE_TIMEOUT` | playback | warn | yes | `errors.playback.playback_source_timeout` |
| `PLAYBACK_MANIFEST_INVALID` | playback | error | yes | `errors.playback.playback_manifest_invalid` |
| `PLAYBACK_DRM_OR_POLICY_BLOCKED` | playback | warn | no | `errors.playback.playback_drm_or_policy_blocked` |
| `CACHE_READ_FAILED` | cache | warn | yes | `errors.cache.cache_read_failed` |
| `CACHE_WRITE_FAILED` | cache | warn | yes | `errors.cache.cache_write_failed` |
| `API_UNAVAILABLE` | api | error | yes | `errors.api.api_unavailable` |

## Usage

```ts
import { buildErrorReport, isErrorCode } from "@dzhoof/shared";

if (isErrorCode(raw)) {
  const report = buildErrorReport(raw, { correlationId: req.requestId, httpStatus: 504 });
  // report.errorCode / report.retryable / report.userMessageKey / report.remediation
}
```

The update endpoint (`GET /api/v1/app/version`) returns `errorCode`, `userMessageKey`
and `retryable` alongside the legacy `error` string, so shipped clients keep working
while new clients branch on the code.
