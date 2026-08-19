import axios from 'axios';
import jwt from 'jsonwebtoken';
import Device from '../models/Device';
import Subscription from '../models/Subscription';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const MAX_TOKENS_PER_SEND = 5000;

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
    .limit(MAX_TOKENS_PER_SEND)
    .lean()
    .exec();
  const tokens = devices.map((device: any) => device.pushToken).filter(Boolean);
  if (!tokens.length) return { configured: true, attempted: 0, sent: 0, failed: 0 };

  const accessToken = await getAccessToken(config);
  if (!accessToken) throw new Error('Unable to obtain FCM access token');

  let sent = 0;
  let failed = 0;
  for (const token of tokens) {
    try {
      await axios.post(
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
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn('[fcm] failed to send notification to one device:', error instanceof Error ? error.message : error);
    }
  }
  return { configured: true, attempted: tokens.length, sent, failed };
}
