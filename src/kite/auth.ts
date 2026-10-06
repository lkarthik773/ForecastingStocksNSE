import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import axios from 'axios';
import type { KiteConfig, KiteUser } from './config.js';
import { KiteReadError } from './client.js';

export interface KiteSession {
  accessToken: string;
  userId: string;
}

export type TokenExchanger = (config: KiteConfig, user: KiteUser, requestToken: string) => Promise<KiteSession>;

export const exchangeKiteToken: TokenExchanger = async (config, user, requestToken) => {
  if (!user.kiteApiSecret || !user.kiteUserId)
    throw new KiteReadError(409, 'Configure kiteApiSecret and kiteUserId on the backend before login.');
  const checksum = createHash('sha256')
    .update(user.kiteApiKey + requestToken + user.kiteApiSecret).digest('hex');
  try {
    const response = await axios.post(`${config.apiBaseUrl}/session/token`, new URLSearchParams({
      api_key: user.kiteApiKey,
      request_token: requestToken,
      checksum,
    }).toString(), {
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: config.timeoutMs,
      maxRedirects: 0,
      maxContentLength: 65536,
      proxy: false,
    });
    const data = response.data?.data;
    if (response.data?.status !== 'success' || data?.api_key !== user.kiteApiKey ||
        data?.user_id !== user.kiteUserId || typeof data?.access_token !== 'string' ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(data.access_token))
      throw new KiteReadError(424, 'Kite login did not return the expected account and app. Start a new login.');
    return { accessToken: data.access_token, userId: data.user_id };
  } catch (error) {
    if (error instanceof KiteReadError) throw error;
    throw new KiteReadError(424, 'Kite token exchange failed. Check backend app credentials and start a new login.');
  }
};

interface PendingLogin {
  user: KiteUser;
  browserToken: string;
  expiresAt: number;
}

export class KiteLoginFlow {
  private readonly pending = new Map<string, PendingLogin>();
  private readonly exchanging = new Set<string>();
  readonly lifetimeSeconds = 300;

  constructor(
    private readonly config: KiteConfig,
    private readonly exchange: TokenExchanger = exchangeKiteToken,
    private readonly now: () => number = Date.now
  ) {}

  begin(user: KiteUser) {
    if (!user.kiteApiSecret || !user.kiteUserId)
      throw new KiteReadError(409, 'Configure kiteApiSecret and kiteUserId on the backend before login.');
    if (this.exchanging.has(user.username))
      throw new KiteReadError(429, 'A login exchange is already in progress.');
    for (const [state, pending] of this.pending) {
      if (pending.expiresAt <= this.now() || pending.user.username === user.username)
        this.pending.delete(state);
    }
    const state = randomBytes(32).toString('base64url');
    const browserToken = randomBytes(32).toString('base64url');
    this.pending.set(state, { user, browserToken, expiresAt: this.now() + this.lifetimeSeconds * 1000 });
    const loginUrl = new URL('https://kite.zerodha.com/connect/login');
    loginUrl.search = new URLSearchParams({
      v: '3', api_key: user.kiteApiKey,
      redirect_params: new URLSearchParams({ state }).toString(),
    }).toString();
    return { loginUrl: loginUrl.toString(), browserToken };
  }

  async complete(state: string, browserToken: string, requestToken: string) {
    const pending = this.pending.get(state);
    if (!pending || pending.expiresAt <= this.now()) {
      this.pending.delete(state);
      throw new KiteReadError(400, 'Login state is missing, expired or already used. Start login from Swagger.');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(browserToken) ||
        !timingSafeEqual(Buffer.from(browserToken), Buffer.from(pending.browserToken)))
      throw new KiteReadError(400, 'Login browser verification failed. Use the same browser that started login.');
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(requestToken))
      throw new KiteReadError(400, 'Missing or invalid Kite request token. Start a new login.');
    this.pending.delete(state);
    this.exchanging.add(pending.user.username);
    try {
      const session = await this.exchange(this.config, pending.user, requestToken);
      if (session.userId !== pending.user.kiteUserId ||
          !/^[A-Za-z0-9_-]{1,256}$/.test(session.accessToken))
        throw new KiteReadError(424, 'Kite login account verification failed.');
      pending.user.kiteAccessToken = session.accessToken;
    } finally {
      this.exchanging.delete(pending.user.username);
    }
  }
}