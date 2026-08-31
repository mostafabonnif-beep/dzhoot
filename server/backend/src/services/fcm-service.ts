import axios from 'axios';
import jwt from 'jsonwebtoken';
import Device from '../models/Device';
import Subscription from '../models/Subscription';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Fire-and-forget per-token sends are capped in flight to avoid hammering FCM. */
const SEND_CONCURRENCY = 25;

function getConfig() {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

async function getAccessToken(config: ReturnType<typeof getConfig>) {
  if (!config) return null;
  const assertion = jwt.sign(
    {
      iss: config.clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    config.privateKey,
    { algorithm: 'RS256' },
  );
  const response = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 },
  );
  return response.data?.access_token as string;
}

export async function sendNotificationToDevices(notification: {
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  audience: 'ALL' | 'ACTIVE';
}) {
  const config = getConfig();
  if (!config) {
    return { configured: false, attempted: 0, sent: 0, failed: 0, skipped: 'FCM is not configured' };
  }

  const userIds = notification.audience === 'ACTIVE'
    ? await Subscription.distinct('userId', { status: 'ACTIVE' }).exec()
    : null;
  const filter: Record<string, unknown> = { pushToken: { $exists: true, $ne: '' } };
  if (userIds) filter.userId = { $in: userIds };

  const devices = await Device.find(filter)
    .select('+pushToken')
    .lean()
    .exec();
  const tokens = devices.map((device: any) => device.pushToken).filter(Boolean);
  if (!tokens.length) return { configured: true, attempted: 0, sent: 0, failed: 0 };

  const accessToken = await getAccessToken(config);
  if (!accessToken) throw new Error('Unable to obtain FCM access token');

  let sent = 0;
  let failed = 0;
  // Send to ALL registered tokens (previously capped at MAX_TOKENS_PER_SEND,
  // silently dropping devices beyond the first batch). Bound concurrency so a
  // large device table doesn't spawn thousands of simultaneous requests.
  for (let offset = 0; offset < tokens.length; offset += SEND_CONCURRENCY) {
    const chunk = tokens.slice(offset, offset + SEND_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((token) =>
        axios.post(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
          {
            message: {
              token,
              notification: {
                title: notification.title,
                body: notification.body,
                ...(notification.imageUrl ? { image: notification.imageUrl } : {}),
              },
              data: notification.deepLink ? { deepLink: notification.deepLink } : undefined,
            },
          },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 10000 },
        ),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        sent += 1;
      } else {
        failed += 1;
        console.warn('[fcm] failed to send notification to one device:', r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
  }
  return { configured: true, attempted: tokens.length, sent, failed };
}

/**
 * Push-outcome summary for a delivery result. The notification itself is
 * ALWAYS marked SENT — the in-app channel delivers regardless of FCM — but
 * pushDelivered/reason tell the operator whether phones actually got the push.
 */
export function pushOutcome(fcm: {
  configured: boolean;
  attempted: number;
  sent: number;
  failed: number;
  skipped?: string;
}): { pushDelivered: boolean; reason: string } {
  if (fcm.configured === false) {
    return { pushDelivered: false, reason: fcm.skipped || 'FCM is not configured' };
  }
  if (fcm.sent > 0) {
    return { pushDelivered: true, reason: '' };
  }
  if (fcm.attempted === 0) {
    return { pushDelivered: false, reason: 'No registered devices with push tokens' };
  }
  return { pushDelivered: false, reason: `All ${fcm.failed} push attempts failed (in-app delivery still works)` };
}
