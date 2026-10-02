import queryModel from "#models/query.model.js";
import { createFAQSchema, updateFAQSchema } from "#schemas/faq.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";


export const  createFAQ = async (req, res) => {
    try {
        const { question } = req.body;
        const {error} = createFAQSchema.validate(req.body, {abortEarly: false, stripUnknown: true})
        if (error) {
            return respondWithError(res, 400, error.details.map((e)=>e.message()).join(' ,'), ERROR_CODES.VALIDATION_ERROR)
        }

        const duplicate = await queryModel.duplicate_check_by_columns('faq', ['question'], [question])
        if (duplicate.length > 0) {
            return respondWithError(res, 400, 'Duplicate FAQ', ERROR_CODES.DUPLICATE_RESOURCE)
        }

        const values = Object.values(req.body)
        const keys = Object.keys(req.body)

        const result = await queryModel.insert('faq', keys, values);
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to add FAQ', ERROR_CODES.RESOURCE_CREATE_FAILED)
        }

        return respondWithSuccess(res, 200, 'FAQ added successfully.', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR)
    }
}

export const  updateFAQ = async (req, res) => {
    try {
        const {faqId} = req.params;
        const { question } = req.body;

        const {error, value} = updateFAQSchema.validate(req.body, {abortEarly: false, stripUnknown: true})
        if (error) {
            return respondWithError(res, 400, error.details.map((e)=>e.message()).join(' ,'), ERROR_CODES.VALIDATION_ERROR)
        }

        const exist = await queryModel.fetch_one_by_key('faq', 'id', faqId)
        if (exist.rowCount  === 0) {
            return respondWithError(res, 404, 'FAQ not found', ERROR_CODES.RESOURCE_NOT_FOUND)
        }

        const duplicate = await queryModel.duplicate_check_by_columns('faq', ['question'], [question])
        if (duplicate.length > 0) {
            return respondWithError(res, 400, 'Duplicate FAQ', ERROR_CODES.DUPLICATE_RESOURCE)
        }

        const result = await queryModel.update_by_id('faq', faqId, value);
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to update FAQ', ERROR_CODES.RESOURCE_UPDATE_FAILED)
        }

        return respondWithSuccess(res, 200, 'FAQ updated successfully.', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR)
    }
}

export const  fetchFAQ = async (req, res) => {
    try {
        const {offset, limit} = req.pagination;
        const result = await queryModel.fetch_all('faq', offset, limit);
        return respondWithSuccess(res, 200, 'FAQ retrieved successfully.', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR)
    }
}

export const  viewFAQ = async (req, res) => {
    try {
        const {faqId} = req.params;

        const result = await queryModel.fetch_one_by_key('faq', 'id', faqId);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Faq not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'FAQ retrieved successfully.', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR)
    }
}

export const  deleteFAQ = async (req, res) => {
    try {
        const {faqId} = req.params;
        
        const result = await queryModel.fetch_one_by_key('faq', 'id', faqId);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Faq not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        await queryModel.delete_by_column('faq', 'id', faqId);
        return respondWithSuccess(res, 200, 'FAQ deleted successfully.');
        
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR)
    }
}