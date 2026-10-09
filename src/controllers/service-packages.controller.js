import ServicePackages from '#models/service-packages.model.js';
import {
    createServicePackageSchema,
    servicePackageParamsSchema,
    updateServicePackageSchema,
} from '#schemas/service-packages.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { serviceError } from '#utils/service-state.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

function validate(schema, input) {
    const { value, error } = schema.validate(input, { abortEarly: false });
    if (error)
        throw serviceError(
            error.details.map((detail) => detail.message).join(', '),
            400
        );
    return value;
}

function providerId(req) {
    const id = req.auth?.vendorId;
    if (!Number.isInteger(id) || id < 1)
        throw serviceError('Vendor authentication required', 403);
    return id;
}

async function respond(work, res, message, successStatus = 200) {
    try {
        const result = await work();
        if (result == null)
            return respondWithError(
                res,
                404,
                'Service package not found',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        return respondWithSuccess(res, successStatus, message, result);
    } catch (error) {
        if (error.code === 'PLAN_LIMIT_REACHED') {
            return res.status(403).json({
                success: false,
                message: error.message,
                result: null,
                code: error.code,
                limit: error.limit,
                limitName: error.limitName,
                currentCount: error.currentCount,
                requestedCount: error.requestedCount,
                planNeeded: error.planNeeded,
            });
        }
        if (error.status && error.status < 500)
            return respondWithError(
                res,
                error.status,
                error.message,
                error.status === 403
                    ? ERROR_CODES.FORBIDDEN
                    : ERROR_CODES.VALIDATION_ERROR
            );
        console.error('Service package request failed:', error);
        return respondWithError(
            res,
            500,
            'Internal server error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
}

export async function list(req, res) {
    return respond(
        () => {
            const { serviceId } = validate(servicePackageParamsSchema, {
                serviceId: req.params.serviceId,
            });
            return ServicePackages.list(serviceId, providerId(req));
        },
        res,
        'Service packages retrieved successfully'
    );
}

export async function create(req, res) {
    return respond(
        () => {
            const { serviceId } = validate(servicePackageParamsSchema, {
                serviceId: req.params.serviceId,
            });
            const data = validate(createServicePackageSchema, req.body);
            return ServicePackages.create(serviceId, providerId(req), data);
        },
        res,
        'Service package created successfully',
        201
    );
}

export async function update(req, res) {
    return respond(
        () => {
            const { serviceId, packageId } = validate(
                servicePackageParamsSchema,
                {
                    serviceId: req.params.serviceId,
                    packageId: req.params.packageId,
                }
            );
            const data = validate(updateServicePackageSchema, req.body);
            return ServicePackages.update(
                serviceId,
                packageId,
                providerId(req),
                data
            );
        },
        res,
        'Service package updated successfully'
    );
}

export async function remove(req, res) {
    return respond(
        () => {
            const { serviceId, packageId } = validate(
                servicePackageParamsSchema,
                {
                    serviceId: req.params.serviceId,
                    packageId: req.params.packageId,
                }
            );
            return ServicePackages.delete(
                serviceId,
                packageId,
                providerId(req)
            );
        },
        res,
        'Service package deleted successfully'
    );
}
