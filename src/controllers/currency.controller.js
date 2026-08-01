import { delete_by_column, duplicate_check_by_columns, fetch_all, fetch_one_by_key, insert, update_by_id } from "#models/query.model.js";
import { createCurrencySchema, updateCurrencySchema } from "#schemas/currencies.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createCurrency = async (req, res) => {
    try {
        const { body } = req;

        const { error } = createCurrencySchema.validate(body, { abortEarly: false });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, currency_code } = body;

        const duplicates = await duplicate_check_by_columns('currencies', ['name', 'currency_code'], [name, currency_code]);
        if (duplicates.length > 0) {
            return respondWithError(res, 409, 'Currency with the same name or code already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const keys = Object.keys(body);
        const values = Object.values(body);

        const result = await insert('currencies', keys, values);
        if (result.rowCount > 0) {
            return respondWithSuccess(res, 201, 'Currency created successfully', result.rows[0]);
        }

        return respondWithError(res, 400, 'Failed to create currency', ERROR_CODES.RESOURCE_CREATE_FAILED);

    } catch (err) {
        console.error('Error creating currency:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateCurrency = async (req, res) => {
    try {
        const { body, params } = req;
        const { currencyId } = params;
        const { error } = updateCurrencySchema.validate(body, { abortEarly: false });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }
        const { name, currency_code, status } = body;

        const existingCurrency = await fetch_one_by_key('currencies', 'id', currencyId);
        if (existingCurrency.rowCount === 0) {
            return respondWithError(res, 404, 'Currency  not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const duplicates = await duplicate_check_by_columns('currencies', ['name', 'currency_code'], [name, currency_code]);
        if (duplicates.length > 0) {
            return respondWithError(res, 409, 'Another currency with the same name or code already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const result = await update_by_id('currencies', currencyId, body);
        if (result.rowCount > 0) {
            return respondWithSuccess(res, 200, 'Currency updated successfully', result.rows[0]);
        }
        return respondWithError(res, 400, 'Failed to update currency', ERROR_CODES.RESOURCE_UPDATE_FAILED);
    } catch (err) {
        console.error('Error updating currency:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchCurrencies = async (req, res) => {
    try {
        const { pagination } = req;
        const { offset, limit } = pagination;
        const result = await fetch_all('currencies', offset, limit);
        return respondWithSuccess(res, 200, 'Currencies fetched successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchCurrencyById = async (req, res) => {
    try {
        const { params } = req;
        const { currencyId } = params;
        const result = await fetch_one_by_key('currencies', 'id', currencyId);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Currency not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Currency fetched successfully', result.rows[0]);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const deleteCurrency = async (req, res) => {
    try {
        const { params } = req;
        const { currencyId } = params;
        const existingCurrency = await fetch_one_by_key('currencies', 'id', currencyId);
        if (existingCurrency.rowCount === 0) {
            return respondWithError(res, 404, 'Currency not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        const result = await delete_by_column('currencies', 'id', currencyId);
        if (result.rowCount > 0) {
            return respondWithSuccess(res, 200, 'Currency deleted successfully');
        }
        return respondWithError(res, 400, 'Failed to delete currency', ERROR_CODES.RESOURCE_DELETE_FAILED);
    } catch (err) {
        console.error('Error deleting currency:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export default {
    createCurrency,
    updateCurrency,
    fetchCurrencies,
    fetchCurrencyById,
    deleteCurrency
}