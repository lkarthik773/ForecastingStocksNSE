export interface WalkForwardFold {
  trainStart: string;
  trainEndExclusive: string;
  testStart: string;
  testEndExclusive: string;
  trainIndexes: number[];
  testIndexes: number[];
}

export function addCalendarMonths(date: string, months: number): string {
  const source = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(source.getTime()) ||
    source.toISOString().slice(0, 10) !== date ||
    !Number.isInteger(months)
  )
    throw new Error('Invalid calendar date or month offset.');
  const target = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1)
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function rollingFolds(
  dates: string[],
  historyStart: string,
  historyEndExclusive: string,
  horizon: number,
  stepMonths = 6,
  trainMonths = 14
): WalkForwardFold[] {
  if (
    !Number.isInteger(horizon) ||
    horizon < 1 ||
    horizon > 15 ||
    !Number.isInteger(stepMonths) ||
    stepMonths < 1 ||
    stepMonths > 24 ||
    !Number.isInteger(trainMonths) ||
    trainMonths < 1 ||
    trainMonths > 120 ||
    dates.some(
      (date, index) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        (index > 0 && date <= dates[index - 1])
    )
  )
    throw new Error(
      'Sorted unique dates, a valid trading-session horizon and a valid month step are required.'
    );
  const folds: WalkForwardFold[] = [];
  for (let offset = 0; ; offset += stepMonths) {
    const trainStart = addCalendarMonths(historyStart, offset);
    const trainEndExclusive = addCalendarMonths(trainStart, trainMonths);
    const testEndExclusive = addCalendarMonths(trainEndExclusive, 3);
    if (testEndExclusive > historyEndExclusive) break;
    const trainIndexes: number[] = [];
    const testIndexes: number[] = [];
    for (let index = 59; index + horizon < dates.length; index++) {
      const targetDate = dates[index + horizon];
      if (
        dates[index] >= trainStart &&
        dates[index] < trainEndExclusive &&
        targetDate < trainEndExclusive
      )
        trainIndexes.push(index);
      if (
        dates[index] >= trainEndExclusive &&
        dates[index] < testEndExclusive &&
        targetDate < testEndExclusive
      )
        testIndexes.push(index);
    }
    if (trainIndexes.length < 120 || testIndexes.length < 20)
      throw new Error(
        'Each complete fold needs at least 120 training labels and 20 test labels.'
      );
    folds.push({
      trainStart,
      trainEndExclusive,
      testStart: trainEndExclusive,
      testEndExclusive,
      trainIndexes,
      testIndexes,
    });
  }
  if (!folds.length)
    throw new Error(
      `History does not contain a complete ${trainMonths}-month train / 3-month test fold.`
    );
  return folds;
}
