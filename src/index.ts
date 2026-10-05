/**
 * NSE-BSE API - Unified TypeScript API for NSE and BSE India stock exchanges
 * 
 * This package provides separate APIs for NSE and BSE while maintaining
 * their individual functionality and keeping them isolated.
 */

// Main exports for convenience
export { NSEClient as NSE } from './nse/index.js';
export { BSE } from './bse/index.js';

// Named exports for specific usage
export { NSEClient } from './nse/index.js';
export type { ForecastParams, ForecastResult, ForecastPoint, ForecastDirection } from './nse/index.js';
export type { FinBertScore, SentimentScorer, TrainedForecast, TrainingObservation, TrainingSentiment } from './nse/index.js';
export type { ForecastContext, ForecastContextOptions, ForecastContextProvider, ContextRequest, NewsArticle, MarketObservation } from './nse/index.js';

// Export namespaced APIs to avoid conflicts
export * as NSEApi from './nse/index.js';
export * as BSEApi from './bse/index.js';