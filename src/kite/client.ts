import axios from 'axios';
import type { KiteConfig, KiteUser } from './config.js';

export const kiteReadPaths = {
  profile: '/user/profile',
  margins: '/user/margins',
  holdings: '/portfolio/holdings',
  positions: '/portfolio/positions',
  orders: '/orders',
  trades: '/trades',
} as const;

export type KiteResource = keyof typeof kiteReadPaths;

export class KiteReadError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function removeSecrets(value: unknown, user: KiteUser): unknown {
  if (Array.isArray(value)) return value.map((item) => removeSecrets(item, user));
  if (value && typeof value === 'object') {
    const secrets = new Set([
      'apikey', 'apisecret', 'accesstoken', 'refreshtoken', 'publictoken',
      'enctoken', 'authorization', 'apitoken', 'kiteapikey', 'kiteaccesstoken', 'kiteapisecret',
    ]);
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !secrets.has(key.replace(/_/g, '').toLowerCase()))
      .map(([key, item]) => [key, removeSecrets(item, user)]));
  }
  if (typeof value === 'string' &&
      [user.apiToken, user.kiteApiKey, user.kiteAccessToken, user.kiteApiSecret].includes(value))
    return '[redacted]';
  return value;
}

export async function readKiteAccount(
  config: KiteConfig,
  user: KiteUser,
  resource: KiteResource
): Promise<unknown> {
  if (!Object.hasOwn(kiteReadPaths, resource))
    throw new KiteReadError(404, 'Unknown account resource.');
  if (!user.kiteAccessToken)
    throw new KiteReadError(424, 'Kite account is not connected. Start login from Swagger.');
  try {
    const response = await axios.get(`${config.apiBaseUrl}${kiteReadPaths[resource]}`, {
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${user.kiteApiKey}:${user.kiteAccessToken}`,
      },
      timeout: config.timeoutMs,
      maxRedirects: 0,
      maxContentLength: 5 * 1024 * 1024,
      proxy: false,
    });
    if (response.data?.status !== 'success' || response.data.data === undefined)
      throw new KiteReadError(502, 'Kite returned an invalid account response.');
    return removeSecrets(response.data.data, user);
  } catch (error) {
    if (error instanceof KiteReadError) throw error;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403)
        throw new KiteReadError(424, 'Kite authentication or permissions failed. Renew the account connection.');
      if (status === 429)
        throw new KiteReadError(429, 'Kite rate limit reached. Try again later.');
    }
    throw new KiteReadError(502, 'Kite account read failed. No trading action was taken.');
  }
}