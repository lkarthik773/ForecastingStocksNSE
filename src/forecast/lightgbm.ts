import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export interface LightGbmTask {
  features: number[][];
  labels: number[];
  folds: { train: number[]; test: number[] }[];
  finalTrain: number[];
  currentFeature: number[];
}

export interface LightGbmOutput {
  forecasts: number[];
  tests: { index: number; predicted: number; actual: number; fold: number }[][];
  version: string;
}

const WORKER = `
import sys, json
import numpy as np
import lightgbm as lgb

payload = json.load(sys.stdin)
forecasts, tests = [], []
for task in payload["tasks"]:
    features = np.asarray(task["features"], dtype=np.float64)
    labels = np.asarray(task["labels"], dtype=np.float64)
    if not np.isfinite(features).all() or not np.isfinite(labels).all():
        raise ValueError("Non-finite training input")
    outputs = []
    def fit(indexes):
        model = lgb.LGBMRegressor(n_estimators=100, num_leaves=15,
            max_depth=4, learning_rate=0.05, min_child_samples=20,
            verbosity=-1, n_jobs=2, random_state=42, force_col_wise=True)
        model.fit(features[indexes], labels[indexes])
        return model
    for fold_number, fold in enumerate(task["folds"]):
        model = fit(fold["train"])
        predicted = model.predict(features[fold["test"]])
        for index, value in zip(fold["test"], predicted):
            outputs.append({"index": index, "predicted": float(value),
                "actual": float(labels[index]), "fold": fold_number})
    model = fit(task["finalTrain"])
    forecast = float(model.predict(np.asarray([task["currentFeature"]], dtype=np.float64))[0])
    forecasts.append(forecast)
    tests.append(outputs)
json.dump({"forecasts": forecasts, "tests": tests, "version": lgb.__version__}, sys.stdout, allow_nan=False)
`;

export function runLightGbm(
  tasks: LightGbmTask[],
  pythonPath = process.env.LIGHTGBM_PYTHON ??
    resolve(
      process.cwd(),
      'node_modules/.cache/lightgbm/venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    )
): Promise<LightGbmOutput> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(pythonPath, ['-c', WORKER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let diagnostic = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('LightGBM training exceeded 120 seconds.'));
    }, 120000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        new Error(
          'LightGBM runtime is unavailable. Run npm run setup:lightgbm or set LIGHTGBM_PYTHON to a Python environment with lightgbm installed.'
        )
      );
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 8 * 1024 * 1024) {
        child.kill();
        reject(new Error('LightGBM output exceeded 8 MB.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-1000);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            diagnostic.includes('ModuleNotFoundError')
              ? 'Python is missing LightGBM dependencies. Run npm run setup:lightgbm.'
              : `LightGBM subprocess failed. Check the configured Python environment.${diagnostic ? ` ${diagnostic.trim()}` : ''}`
          )
        );
        return;
      }
      try {
        const result = JSON.parse(output) as LightGbmOutput;
        if (
          !Array.isArray(result.forecasts) ||
          result.forecasts.length !== tasks.length ||
          !result.forecasts.every(Number.isFinite) ||
          !Array.isArray(result.tests) ||
          result.tests.length !== tasks.length
        )
          throw new Error('Invalid LightGBM output.');
        resolveResult(result);
      } catch {
        reject(new Error('LightGBM produced an invalid response.'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ tasks }));
  });
}
