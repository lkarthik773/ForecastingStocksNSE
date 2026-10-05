/**
 * NSE API Module
 * 
 * Re-exports all NSE functionality from the original nseapi package
 */

// Main NSE client
export { NSEClient } from "./nse/nse-client.js";

// Export types for TypeScript users
export * from "./types/index.js";

// Export constants
export * from "./constants/index.js";

// Export utilities
export * from "./utils/date-formatter.js";
export * from "./utils/file-operations.js";

// Export API modules for advanced usage
export { EquityApi } from "./api/equity-api.js";
export { OptionsApi } from "./api/options-api.js";
export { HistoricalApi } from "./api/historical-api.js";
export { ForecastApi, ForecastInputError, ForecastDataError } from "./api/forecast-api.js";
export type { ForecastParams, ForecastResult, ForecastPoint, ForecastDirection } from "./api/forecast-api.js";
export { ForecastContextApi } from "./api/forecast-context-api.js";
export { FinBertScorer } from "./api/finbert.js";
export type { FinBertScore, SentimentScorer } from "./api/finbert.js";
export type { TrainedForecast, TrainingObservation, TrainingSentiment } from "./api/trained-forecast.js";
export type { ForecastContext, ForecastContextOptions, ForecastContextProvider, ContextRequest, NewsArticle, MarketObservation } from "./api/forecast-context-api.js";
export { CorporateApi } from "./api/corporate-api.js";
export { IpoApi } from "./api/ipo-api.js";
export { MarketApi } from "./api/market-api.js";
export { DownloadApi } from "./api/download-api.js";
export { HttpClient } from "./http/http-client.js";