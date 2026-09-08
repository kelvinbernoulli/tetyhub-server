import Services from '#models/services.model.js';
import {
    createServiceSchema,
    updateServiceSchema,
    serviceSearchSchema,
    serviceIdSchema,
} from '#schemas/services.schema.js';
import { serviceError } from '#utils/service-state.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';
const validate = (schema, input) => {
    const { value, error } = schema.validate(input, { abortEarly: false });
    if (error)
        throw serviceError(
            error.details.map((detail) => detail.message).join(', '),
            400
        );
    return value;
};
const vendor = (req) => {
    const id = req.auth?.vendorId;
    if (!Number.isInteger(id) || id < 1)
        throw serviceError('Vendor authentication required', 403);
    return id;
};
const endpoint =
    (work, message, status = 200) =>
    async (req, res) => {
        try {
            const result = await work(req);
            if (result == null)
                return respondWithError(
                    res,
                    404,
                    'Service not found',
                    ERROR_CODES.RESOURCE_NOT_FOUND
                );
            return respondWithSuccess(res, status, message, result);
        } catch (error) {
            const status =
                error.status ??
                (error.code === '23503'
                    ? 422
                    : error.code === '23505'
                      ? 409
                      : 500);
            if (status >= 500) console.error('Service request failed:', error);
            const message =
                error.status && status < 500
                    ? error.message
                    : status === 422
                      ? 'Invalid service reference'
                      : status === 409
                        ? 'Service conflicts with an existing record'
                        : 'Internal server error';
            const code =
                status === 403
                    ? ERROR_CODES.FORBIDDEN
                    : status === 409
                      ? ERROR_CODES.RESOURCE_CONFLICT
                      : status < 500
                        ? ERROR_CODES.VALIDATION_ERROR
                        : ERROR_CODES.INTERNAL_SERVER_ERROR;
            return respondWithError(res, status, message, code);
        }
    };
export const createService = endpoint(
    (req) =>
        Services.create(vendor(req), validate(createServiceSchema, req.body)),
    'Service created successfully',
    201
);
export const updateService = endpoint(
    (req) =>
        Services.update(
            validate(serviceIdSchema, req.params.id),
            vendor(req),
            validate(updateServiceSchema, req.body)
        ),
    'Service updated successfully'
);
export const fetchServices = endpoint(
    (req) =>
        Services.read(
            vendor(req),
            validate(serviceSearchSchema, req.query ?? {})
        ),
    'Services retrieved successfully'
);
export const viewService = endpoint(
    (req) =>
        Services.view(validate(serviceIdSchema, req.params.id), vendor(req)),
    'Service retrieved successfully'
);
export const deleteService = endpoint(
    (req) =>
        Services.delete(validate(serviceIdSchema, req.params.id), vendor(req)),
    'Service deleted successfully'
);
