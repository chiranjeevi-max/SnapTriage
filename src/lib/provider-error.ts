/**
 * @module lib/provider-error
 *
 * Structured error class for provider API failures. Captures the HTTP status,
 * response body, and operation context so callers can log, report, and
 * decide on retry strategies.
 */

export class ProviderApiError extends Error {
  /** HTTP status code from the provider API. */
  readonly status: number;
  /** Raw response body text (truncated to 500 chars). */
  readonly responseBody: string;
  /** Provider name (github/gitlab). */
  readonly provider: string;
  /** The operation that failed (e.g., "fetchIssues", "updateIssue"). */
  readonly operation: string;

  constructor(
    status: number,
    responseBody: string,
    context: { provider: string; operation: string; owner?: string; repo?: string }
  ) {
    const target = context.owner && context.repo ? ` on ${context.owner}/${context.repo}` : "";
    super(
      `${context.provider} API error during ${context.operation}${target}: HTTP ${status}`
    );
    this.name = "ProviderApiError";
    this.status = status;
    this.responseBody = responseBody.slice(0, 500);
    this.provider = context.provider;
    this.operation = context.operation;
  }

  /** Whether this error is retryable (rate limit, server error). */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** Whether this is an authentication error (token expired/invalid). */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
