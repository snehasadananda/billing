class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const badRequest = (code, msg, details) => new AppError(400, code, msg, details);
const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (code, msg) => new AppError(409, code, msg);
const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', msg);

module.exports = { AppError, badRequest, notFound, conflict, forbidden };
