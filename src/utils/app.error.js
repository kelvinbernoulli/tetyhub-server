import ERROR_CODES from './error.codes.js';

export class AppError extends Error {
    constructor(message, status = 500, code = ERROR_CODES.INTERNAL_SERVER_ERROR) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
    }
}

export const conflictError = (message) => new AppError(
    message,
    409,
    ERROR_CODES.RESOURCE_CONFLICT
);

export const forbiddenError = (message = 'You are not authorized to perform this action.') => (
    new AppError(message, 403, ERROR_CODES.FORBIDDEN)
);

export const notFoundError = (message) => new AppError(
    message,
    404,
    ERROR_CODES.RESOURCE_NOT_FOUND
);

export default AppError;
