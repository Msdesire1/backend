/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * handler instead of hanging the request. Saves a try/catch in every controller.
 *
 *   router.get("/", asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export default asyncHandler;
