/**
 * The parts of the Sentry SDK Dispatchlet uses, and nothing else. Importing the whole package
 * dynamically kept Replay, rrweb and Feedback in the chunk (about 140 KB gzipped); named
 * re-exports let the bundler drop them.
 */
export {
  captureException,
  dedupeIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
} from '@sentry/browser'
