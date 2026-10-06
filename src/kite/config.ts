export interface KiteUser {
  username: string;
  apiToken: string;
  kiteApiKey: string;
  kiteAccessToken: string;
  kiteApiSecret?: string;
  kiteUserId?: string;
}

export interface KiteConfig {
  host: string;
  port: number;
  publicOrigin?: string;
  apiBaseUrl: string;
  timeoutMs: number;
  minReadIntervalMs: number;
  redirectUrl: string;
  users: KiteUser[];
}

export function loadKiteConfig(env: NodeJS.ProcessEnv = process.env): KiteConfig {
  const host = env.KITE_HOST ?? '127.0.0.1';
  const port = Number(env.KITE_PORT ?? 3102);
  const timeoutMs = Number(env.KITE_TIMEOUT_MS ?? 10000);
  const minReadIntervalMs = Number(env.KITE_MIN_READ_INTERVAL_MS ?? 1000);
  if (!Number.isInteger(minReadIntervalMs) || minReadIntervalMs < 1000 || minReadIntervalMs > 60000)
    throw new Error('KITE_MIN_READ_INTERVAL_MS must be between 1000 and 60000.');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('KITE_PORT must be between 1 and 65535.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000)
    throw new Error('KITE_TIMEOUT_MS must be between 1000 and 30000.');
  const publicOrigin = env.KITE_PUBLIC_ORIGIN || undefined;
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin)
      throw new Error('KITE_PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !publicOrigin)
    throw new Error('Remote binding requires KITE_PUBLIC_ORIGIN and an HTTPS proxy.');
  const serviceOrigin = publicOrigin ?? `http://${host === '::1' ? '[::1]' : host}:${port}`;
  const redirectUrl = env.KITE_REDIRECT_URL ?? `${serviceOrigin}/auth/kite/callback`;
  const redirect = new URL(redirectUrl);
  if (redirect.origin !== serviceOrigin || redirect.search || redirect.hash ||
      !['/', '/auth/kite/callback'].includes(redirect.pathname))
    throw new Error('KITE_REDIRECT_URL must use the service origin and /auth/kite/callback or / without query parameters.');
  const apiBaseUrl = env.KITE_API_BASE_URL ?? 'https://api.kite.trade';
  if (apiBaseUrl !== 'https://api.kite.trade')
    throw new Error('KITE_API_BASE_URL must be the official HTTPS Kite API origin.');
  let input: unknown;
  try {
    input = JSON.parse(env.KITE_USERS_JSON ?? 'null');
  } catch {
    throw new Error('KITE_USERS_JSON must be valid JSON; values are not logged.');
  }
  if (!Array.isArray(input) || input.length === 0)
    throw new Error('KITE_USERS_JSON must contain at least one user connection.');
  const usernames = new Set<string>();
  const tokens = new Set<string>();
  const users: KiteUser[] = input.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid user connection configuration.');
    const record = value as Record<string, unknown>;
    for (const key of ['username', 'apiToken', 'kiteApiKey']) {
      if (typeof record[key] !== 'string' || !(record[key] as string).trim())
        throw new Error(`Each user requires ${key}.`);
    }
    const user = record as unknown as KiteUser;
    const kiteAccessToken = record.kiteAccessToken ?? '';
    const kiteApiSecret = record.kiteApiSecret || undefined;
    const kiteUserId = record.kiteUserId || undefined;
    if (typeof kiteAccessToken !== 'string' ||
        (kiteApiSecret !== undefined && (typeof kiteApiSecret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(kiteApiSecret))) ||
        (kiteUserId !== undefined && (typeof kiteUserId !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(kiteUserId))))
      throw new Error('Invalid Kite token, secret or expected account ID configuration.');
    if (kiteApiSecret && !kiteUserId)
      throw new Error('kiteUserId is required with kiteApiSecret to verify account ownership.');
    if (!kiteAccessToken && !kiteApiSecret)
      throw new Error('Each user requires an access token or an API secret with kiteUserId for login.');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(user.username))
      throw new Error('Usernames must be 1-64 letters, digits, underscores or hyphens.');
    if (!/^[A-Za-z0-9_-]{43,256}$/.test(user.apiToken))
      throw new Error('API tokens must be 43-256 URL-safe characters; use random secrets.');
    if (!/^[A-Za-z0-9_-]+$/.test(user.kiteApiKey) ||
        (kiteAccessToken && !/^[A-Za-z0-9_-]+$/.test(kiteAccessToken)))
      throw new Error('Kite keys and access tokens must be URL-safe strings.');
    if (usernames.has(user.username) || tokens.has(user.apiToken))
      throw new Error('Usernames and API tokens must be unique.');
    usernames.add(user.username);
    tokens.add(user.apiToken);
    return {
      username: user.username,
      apiToken: user.apiToken,
      kiteApiKey: user.kiteApiKey,
      kiteAccessToken,
      kiteApiSecret,
      kiteUserId,
    };
  });
  return { host, port, publicOrigin, apiBaseUrl, timeoutMs, minReadIntervalMs, redirectUrl, users };
}