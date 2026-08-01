import { delete_by_column, duplicate_check_by_columns, fetch_all, fetch_all_by_columns, fetch_joined, fetch_one_by_key, insert, update_by_id } from "#models/query.model.js";
import { createCountrySchema, updateCountrySchema } from "#schemas/countries.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createCountry = async (req, res) => {
    try {
        const { body } = req;

        const { error } = createCountrySchema.validate(body, { abortEarly: false });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, country_code, dial_code, flag } = body;

        const duplicates = await duplicate_check_by_columns('countries', ['name', 'country_code', 'dial_code'], [name, country_code, dial_code]);
        if (duplicates.length > 0) {
            return respondWithError(res, 409, 'Country with the same name, code, or dial code already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const filename = `images/country-flags/${name}.${getBase64Extension(flag)}`;
        await S3upload(req, res, filename, flag);
        body.flag = filename;

        const keys = Object.keys(body);
        const values = Object.values(body);

        const result = await insert('countries', keys, values);

        if (result.rowCount > 0) {
            return respondWithSuccess(res, 201, 'Country created successfully', result.rows[0]);
        }

        return respondWithError(res, 400, 'Failed to create country', ERROR_CODES.RESOURCE_CREATE_FAILED);

    } catch (err) {
        console.error('Error creating country:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateCountry = async (req, res) => {
    try {
        const { body, params } = req;
        const { countryId } = params;
        const { error } = updateCountrySchema.validate(body, { abortEarly: false });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }
        const { name, country_code, dial_code, flag } = body;

        const existingCountry = await fetch_one_by_key('countries', 'id', countryId);
        if (existingCountry.rowCount === 0) {
            return respondWithError(res, 404, 'Country not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const duplicates = await duplicate_check_by_columns('countries', ['name', 'country_code', 'dial_code'], [name, country_code, dial_code]);
        if (duplicates.length > 0) {
            return respondWithError(res, 409, 'Another country with the same name, code, or dial code already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        if (flag) {
            const filename = `images/country-flags/${name}.${getBase64Extension(flag)}`;
            await S3upload(req, res, filename, flag);
            await S3delete(existingCountry.rows[0].flag);
            body.flag = filename;
        }

        const result = await update_by_id('countries', countryId, body);
        if (result.rowCount > 0) {
            return respondWithSuccess(res, 200, 'Country updated successfully', result.rows[0]);
        }
        return respondWithError(res, 400, 'Failed to update country', ERROR_CODES.RESOURCE_UPDATE_FAILED);
    } catch (err) {
        console.error('Error updating country:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchCountries = async (req, res) => {
    try {
        const { pagination } = req;
        const { offset, limit } = pagination;
        const result = await fetch_joined('countries', 'currencies', 'currency_id', 'id', offset, limit);
        return respondWithSuccess(res, 200, 'Countries fetched successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchCountryById = async (req, res) => {
    try {
        const { params } = req;
        const { countryId } = params;
        const result = await fetch_one_by_key('countries', 'id', countryId);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Country not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Country fetched successfully', result.rows[0]);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const deleteCountry = async (req, res) => {
    try {
        const { params } = req;
        const { countryId } = params;
        const existingCountry = await fetch_one_by_key('countries', 'id', countryId);
        if (existingCountry.rowCount === 0) {
            return respondWithError(res, 404, 'Country not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        await S3delete(existingCountry.rows[0].flag);
        const result = await delete_by_column('countries', 'id', countryId);
        if (result.rowCount > 0) {
            return respondWithSuccess(res, 200, 'Country deleted successfully');
        }
        return respondWithError(res, 400, 'Failed to delete country', ERROR_CODES.RESOURCE_DELETE_FAILED);
    } catch (err) {
        console.error('Error deleting country:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export default {
    createCountry,
    updateCountry,
    fetchCountries,
    fetchCountryById,
    deleteCountry
}