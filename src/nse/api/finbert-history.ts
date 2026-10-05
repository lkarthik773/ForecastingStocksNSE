import { readFile, stat } from 'node:fs/promises';
import type { FinBertScore, SentimentScorer } from './finbert.js';
import type {
  TrainingObservation,
  TrainingSentiment,
} from './trained-forecast.js';

export interface ArchivedHeadline {
  publishedAt: string;
  title: string;
}
export interface FinBertArchive {
  symbol: string;
  articles: ArchivedHeadline[];
}

export async function loadFinBertArchive(
  path: string | undefined,
  symbol: string
): Promise<FinBertArchive> {
  if (!path)
    throw new Error(
      'Joint FinBERT training requires FINBERT_NEWS_ARCHIVE: a local historical headline archive.'
    );
  if ((await stat(path)).size > 5 * 1024 * 1024)
    throw new Error('News archive exceeds 5 MB.');
  const input = JSON.parse(await readFile(path, 'utf8'));
  if (
    !input ||
    input.version !== 1 ||
    (input.symbol !== symbol && input.symbol !== 'GLOBAL') ||
    !Array.isArray(input.articles) ||
    input.articles.length > 2000
  )
    throw new Error(
      'Archive must have version 1, the requested symbol or GLOBAL, and at most 2000 headlines.'
    );
  for (const article of input.articles) {
    if (
      !article ||
      typeof article.title !== 'string' ||
      !article.title.trim() ||
      article.title.length > 2000 ||
      typeof article.publishedAt !== 'string' ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(article.publishedAt) ||
      !Number.isFinite(Date.parse(article.publishedAt))
    )
      throw new Error('Archive contains an invalid timestamp or headline.');
  }
  return { symbol: input.symbol, articles: input.articles };
}

export async function historicalFinBertFeatures(
  archive: FinBertArchive,
  observations: TrainingObservation[],
  asOf: string,
  scorer: SentimentScorer
): Promise<TrainingSentiment[]> {
  const cutoff = Date.parse(asOf);
  const earliest = Date.parse(observations[0].date) - 3 * 86400000;
  const articles = archive.articles.filter(
    (article) =>
      Date.parse(article.publishedAt) < cutoff &&
      Date.parse(article.publishedAt) >= earliest
  );
  const unique = [
    ...new Map(
      articles.map((article) => [
        `${article.publishedAt}:${article.title.trim()}`,
        article,
      ])
    ).values(),
  ];
  const windows = observations.map((row) => {
    const end = Date.parse(`${row.date}T15:30:00+05:30`);
    const indexes = unique.flatMap((article, index) =>
      Date.parse(article.publishedAt) <= end &&
      Date.parse(article.publishedAt) > end - 3 * 86400000
        ? [index]
        : []
    );
    return { date: row.date, asOf: new Date(end).toISOString(), indexes };
  });
  const covered = windows.filter((row) => row.indexes.length >= 3);
  if (
    covered.length < 180 ||
    Date.parse(covered.at(-1)!.date) - Date.parse(covered[0].date) <
      180 * 86400000
  )
    throw new Error(
      'Joint training needs news coverage on at least 180 price dates spanning 180 calendar days. No model was trained or downloaded for this short archive.'
    );
  const scores: FinBertScore[] = [];
  for (let offset = 0; offset < unique.length; offset += 100)
    scores.push(
      ...(await scorer.score(
        unique.slice(offset, offset + 100).map((article) => article.title)
      ))
    );
  return covered.map((row) => ({
    date: row.date,
    asOf: row.asOf,
    polarity:
      row.indexes.reduce((total, index) => total + scores[index].polarity, 0) /
      row.indexes.length,
    articles: row.indexes.length,
  }));
}
