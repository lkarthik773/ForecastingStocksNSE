export interface FinBertScore {
  positive: number;
  negative: number;
  neutral: number;
  polarity: number;
}

export interface SentimentScorer {
  score(texts: string[]): Promise<FinBertScore[]>;
}

type LabelScore = { label: string; score: number };
type Classifier = (
  texts: string[],
  options: { top_k: number; truncation: boolean; max_length: number }
) => Promise<unknown>;

export class FinBertScorer implements SentimentScorer {
  static readonly model = 'ProsusAI/finbert';
  static readonly runtimeModel = 'Xenova/finbert';
  private classifier?: Promise<Classifier>;
  private cache = new Map<string, FinBertScore>();

  constructor(
    private cacheDir?: string,
    private loader?: () => Promise<Classifier>
  ) {}

  private load(): Promise<Classifier> {
    if (!this.classifier) {
      const load =
        this.loader ??
        (async () => {
          const { pipeline, env } = await import('@huggingface/transformers');
          if (this.cacheDir) env.cacheDir = this.cacheDir;
          const classifier = await pipeline(
            'text-classification',
            FinBertScorer.runtimeModel,
            { dtype: 'q8', device: 'cpu' }
          );
          return classifier as unknown as Classifier;
        });
      this.classifier = load().catch(() => {
        this.classifier = undefined;
        throw new Error(
          'Local FinBERT could not initialize. Check the optional Transformers.js dependency and model download/cache.'
        );
      });
    }
    return this.classifier;
  }

  async score(texts: string[]): Promise<FinBertScore[]> {
    if (
      texts.length > 100 ||
      texts.some(
        (text) => typeof text !== 'string' || !text.trim() || text.length > 2000
      )
    )
      throw new Error(
        'FinBERT accepts at most 100 non-empty headlines of 2000 characters or less.'
      );
    if (!texts.length) return [];
    const requested = new Map(
      texts.map((text) => [text, this.cache.get(text)])
    );
    const missing = [...new Set(texts.filter((text) => !this.cache.has(text)))];
    if (missing.length) {
      const classifier = await this.load();
      const pending = new Map<string, FinBertScore>();
      for (let offset = 0; offset < missing.length; offset += 4) {
        const batch = missing.slice(offset, offset + 4);
        const output = await classifier(batch, {
          top_k: 3,
          truncation: true,
          max_length: 128,
        });
        if (!Array.isArray(output) || output.length !== batch.length)
          throw new Error('Invalid FinBERT output batch.');
        for (const [index, labels] of output.entries()) {
          if (!Array.isArray(labels) || labels.length !== 3)
            throw new Error('FinBERT did not return all three classes.');
          const probabilities = new Map<string, number>();
          for (const item of labels as LabelScore[]) {
            if (
              !item ||
              typeof item.label !== 'string' ||
              !Number.isFinite(item.score) ||
              item.score < 0 ||
              item.score > 1
            )
              throw new Error('Invalid FinBERT class probability.');
            probabilities.set(item.label.toLowerCase(), item.score);
          }
          if (
            !['positive', 'negative', 'neutral'].every((label) =>
              probabilities.has(label)
            ) ||
            Math.abs(
              [...probabilities.values()].reduce(
                (total, value) => total + value,
                0
              ) - 1
            ) > 0.01
          )
            throw new Error(
              'Invalid FinBERT class labels or probability total.'
            );
          const positive = probabilities.get('positive')!;
          const negative = probabilities.get('negative')!;
          pending.set(batch[index], {
            positive,
            negative,
            neutral: probabilities.get('neutral')!,
            polarity: positive - negative,
          });
        }
      }
      for (const [text, result] of pending) {
        requested.set(text, result);
        if (this.cache.size >= 2000)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(text, result);
      }
    }
    return texts.map((text) => ({ ...requested.get(text)! }));
  }
}
