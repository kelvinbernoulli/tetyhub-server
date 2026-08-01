export const respondWithSuccess = (res, status, message, data = null) => {
    return res.status(status).json({
        success: true,
        message,
        result: data,
        code: 0,
    });
};

export const respondWithError = (res, status, message, code = 0) => {
    return res.status(status).json({
        success: false,
        message,
        result: null,
        code,
    });
};