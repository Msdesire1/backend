/**
 * An error carrying an HTTP status code, an optional machine-readable `code`,
 * and optional per-field `errors` — the same envelope the existing auth
 * controller returns by hand, so responses stay consistent across the API.
 */
export default class ApiError extends Error {
  constructor(statusCode, message, { code, errors } = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    if (code) this.code = code;
    if (errors) this.errors = errors;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message, options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = "Authentication is required.", options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = "You do not have access to this resource.", options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = "Resource not found.", options) {
    return new ApiError(404, message, options);
  }

  static conflict(message, options) {
    return new ApiError(409, message, options);
  }

  static payloadTooLarge(message, options) {
    return new ApiError(413, message, options);
  }

  static unsupportedMediaType(message, options) {
    return new ApiError(415, message, options);
  }

  /** Validation failures. `errors` is a field -> message map the form can render. */
  static unprocessable(message = "Please correct the highlighted fields.", errors) {
    return new ApiError(422, message, { errors });
  }

  static tooManyRequests(message = "Too many requests. Please try again shortly.", options) {
    return new ApiError(429, message, options);
  }
}
