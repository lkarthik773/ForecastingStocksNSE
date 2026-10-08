export type BinaryClassifier = (features: number[]) => number;

const iterations = 800;
const learningRate = 0.1;
const l2Penalty = 0.01;

export function fitLogisticClassifier(
  features: number[][],
  labels: number[]
): BinaryClassifier {
  if (
    !features.length ||
    features.length !== labels.length ||
    !features[0]?.length ||
    features.some(
      (row) =>
        row.length !== features[0].length ||
        row.some((value) => !Number.isFinite(value))
    ) ||
    labels.some((label) => label !== 0 && label !== 1)
  )
    throw new Error('Logistic training needs matching finite feature rows and binary labels.');

  const dimension = features[0].length;
  const means = Array.from({ length: dimension }, (_, column) =>
    features.reduce((sum, row) => sum + row[column], 0) / features.length
  );
  const scales = Array.from({ length: dimension }, (_, column) => {
    const variance =
      features.reduce(
        (sum, row) => sum + (row[column] - means[column]) ** 2,
        0
      ) / features.length;
    const scale = Math.sqrt(variance);
    return scale > 0 ? scale : 1;
  });
  const standardized = features.map((row) =>
    row.map((value, column) => (value - means[column]) / scales[column])
  );
  const weights = Array(dimension).fill(0) as number[];
  let intercept = 0;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradients = Array(dimension).fill(0) as number[];
    let interceptGradient = 0;
    for (let rowIndex = 0; rowIndex < standardized.length; rowIndex++) {
      const row = standardized[rowIndex];
      const logit = intercept + row.reduce(
        (sum, value, column) => sum + value * weights[column],
        0
      );
      const probability = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
      const error = probability - labels[rowIndex];
      interceptGradient += error;
      for (let column = 0; column < dimension; column++)
        gradients[column] += error * row[column];
    }
    const divisor = standardized.length;
    intercept -= learningRate * interceptGradient / divisor;
    for (let column = 0; column < dimension; column++)
      weights[column] -= learningRate *
        (gradients[column] / divisor + l2Penalty * weights[column]);
  }

  return (row) => {
    if (
      row.length !== dimension ||
      row.some((value) => !Number.isFinite(value))
    )
      throw new Error('Logistic prediction needs a finite feature vector matching the training data.');
    const logit = intercept + row.reduce(
      (sum, value, column) =>
        sum + ((value - means[column]) / scales[column]) * weights[column],
      0
    );
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
  };
}
