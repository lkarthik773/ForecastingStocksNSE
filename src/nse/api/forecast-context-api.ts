import type { HistoricalApi } from './historical-api.js';
import {
  FinBertScorer,
  type FinBertScore,
  type SentimentScorer,
} from './finbert.js';
import { loadFinBertArchive } from './finbert-history.js';

export interface ContextRequest {
  symbol: string;
  fromDate: string;
  toDate: string;
  asOf: string;
  sentiment?: 'off' | 'finbert';
}
export interface MarketObservation {
  date: string;
  close: number;
}
export interface NewsArticle {
  publishedAt: string;
  title: string;
  url: string;
  polarity: number | null;
  finbert?: FinBertScore;
}
export interface ForecastContext {
  asOf: string;
  market: {
    provider: 'NSE';
    proxy: 'NIFTYBEES';
    status: 'available' | 'unavailable';
    observations: MarketObservation[];
  };
  news: {
    provider: 'Local archive';
    status: 'available' | 'unavailable' | 'not_configured';
    scope: string;
    requestedFrom: string;
    requestedTo: string;
    articles: NewsArticle[];
    scoredArticles: number;
    averagePolarity: number | null;
    todayArticles: number;
    sampleLimited: boolean;
    sentimentEngine?: 'off' | 'finbert';
    sentimentStatus?: 'available' | 'unavailable' | 'not_requested';
  };
  warnings: string[];
}
export interface ForecastContextOptions {
  finbertCacheDir?: string;
  newsArchivePath?: string;
}
export interface ForecastContextProvider {
  getContext(request: ContextRequest): Promise<ForecastContext>;
}

const DAY = 86400000;
const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
export function marketObservations(
  rows: Record<string, unknown>[],
  from: string,
  to: string
): MarketObservation[] {
  const prices = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const symbol = row.chSymbol ?? row.CH_SYMBOL;
    const series = row.chSeries ?? row.CH_SERIES;
    if ((symbol && symbol !== 'NIFTYBEES') || (series && series !== 'EQ'))
      continue;
    const rawDate = row.mtimestamp ?? row.CH_TIMESTAMP ?? row.chTimestamp;
    let date = typeof rawDate === 'string' ? rawDate.slice(0, 10) : '';
    const match =
      typeof rawDate === 'string'
        ? /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(rawDate)
        : null;
    if (match)
      date = `${match[3]}-${String(MONTHS.indexOf(match[2].toLowerCase()) + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    const raw = row.chClosingPrice ?? row.CH_CLOSING_PRICE;
    const close =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw.replace(/,/g, ''))
          : NaN;
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date < from ||
      date > to ||
      !Number.isFinite(close) ||
      close <= 0
    )
      continue;
    if (prices.has(date) && prices.get(date) !== close)
      throw new Error('Conflicting market proxy prices.');
    prices.set(date, close);
  }
  return [...prices]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, close]) => ({ date, close }));
}

export class ForecastContextApi implements ForecastContextProvider {
  private cache = new Map<
    string,
    { expires: number; result: ForecastContext }
  >();
  constructor(
    private historical: Pick<HistoricalApi, 'fetchEquityHistoricalData'>,
    private options: ForecastContextOptions = {},
    private clock: () => number = Date.now,
    private scorer: SentimentScorer = new FinBertScorer(
      options.finbertCacheDir
    ),
    private archiveLoader = loadFinBertArchive
  ) {}

  async getContext(request: ContextRequest): Promise<ForecastContext> {
    const cutoff = new Date(request.asOf);
    const fromNews = new Date(cutoff.getTime() - 14 * DAY)
      .toISOString()
      .slice(0, 10);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(cutoff);
    const live = Math.abs(cutoff.getTime() - this.clock()) < 60000;
    const key = JSON.stringify([
      request.symbol,
      request.fromDate,
      request.toDate,
      live ? `live-${today}` : request.asOf,
      request.sentiment,
    ]);
    const cached = this.cache.get(key);
    if (
      cached &&
      cached.expires > this.clock() &&
      new Date(cached.result.asOf) <= cutoff
    )
      return cached.result;
    const enabled = request.sentiment === 'finbert';
    const result: ForecastContext = {
      asOf: request.asOf,
      market: {
        provider: 'NSE',
        proxy: 'NIFTYBEES',
        status: 'unavailable',
        observations: [],
      },
      news: {
        provider: 'Local archive',
        status:
          enabled && this.options.newsArchivePath
            ? 'unavailable'
            : 'not_configured',
        scope: request.symbol,
        requestedFrom: fromNews,
        requestedTo: cutoff.toISOString().slice(0, 10),
        articles: [],
        scoredArticles: 0,
        averagePolarity: null,
        todayArticles: 0,
        sampleLimited: false,
        sentimentEngine: enabled ? 'finbert' : 'off',
        sentimentStatus: 'not_requested',
      },
      warnings: [],
    };
    try {
      const rows = await this.historical.fetchEquityHistoricalData({
        symbol: 'NIFTYBEES',
        from_date: new Date(`${request.fromDate}T12:00:00`),
        to_date: new Date(`${request.toDate}T12:00:00`),
        series: ['EQ'],
      });
      result.market.observations = marketObservations(
        rows,
        request.fromDate,
        request.toDate
      );
      result.market.status =
        result.market.observations.length >= 60 ? 'available' : 'unavailable';
      if (result.market.status === 'unavailable')
        result.warnings.push(
          'Market proxy has insufficient history; no market adjustment was assumed.'
        );
    } catch {
      result.warnings.push(
        'NSE market context is unavailable; no market adjustment was assumed.'
      );
    }
    if (enabled && this.options.newsArchivePath) {
      try {
        const archive = await this.archiveLoader(
          this.options.newsArchivePath,
          request.symbol
        );
        const eligible = [
          ...new Map(
            archive.articles
              .filter(
                (article) =>
                  Date.parse(article.publishedAt) < cutoff.getTime() &&
                  Date.parse(article.publishedAt) >= cutoff.getTime() - 14 * DAY
              )
              .map((article) => [
                `${article.publishedAt}:${article.title}`,
                article,
              ])
          ).values(),
        ].sort((left, right) =>
          right.publishedAt.localeCompare(left.publishedAt)
        );
        result.news.sampleLimited = eligible.length > 100;
        const articles = eligible.slice(0, 100);
        const scores = await this.scorer.score(
          articles.map((article) => article.title)
        );
        if (scores.length !== articles.length)
          throw new Error('Invalid FinBERT output.');
        result.news.articles = articles.map((article, index) => ({
          ...article,
          url: '',
          polarity: scores[index].polarity,
          finbert: scores[index],
        }));
        result.news.scoredArticles = scores.length;
        result.news.averagePolarity = scores.length
          ? scores.reduce((total, score) => total + score.polarity, 0) /
            scores.length
          : null;
        result.news.todayArticles = articles.filter(
          (article) =>
            new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date(article.publishedAt)) === today
        ).length;
        result.news.status = 'available';
        result.news.sentimentStatus = 'available';
        if (scores.length < 5)
          result.warnings.push(
            'Fewer than five local-archive headlines are available at this cutoff; no news-risk adjustment is applied.'
          );
      } catch {
        result.news.status = 'unavailable';
        result.news.sentimentStatus = 'unavailable';
        result.warnings.push(
          'Local news archive or FinBERT inference is unavailable. No sentiment was assumed.'
        );
      }
    } else if (enabled)
      result.warnings.push(
        'Local FinBERT sentiment requires FINBERT_NEWS_ARCHIVE. No hosted news provider is used.'
      );
    if (this.cache.size >= 32)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { expires: this.clock() + 15 * 60 * 1000, result });
    return result;
  }
}
