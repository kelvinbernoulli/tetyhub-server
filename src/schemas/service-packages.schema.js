import Joi from 'joi';

const MAX_INT = 2147483647;
const id = Joi.number().integer().min(1).max(MAX_INT);
const packageFields = {
    name: Joi.string().trim().min(2).max(100),
    description: Joi.string().trim().max(2000).allow(null, ''),
    price: Joi.number()
        .positive()
        .max(99999999.99)
        .custom((value, helpers) =>
            Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
                ? value
                : helpers.error('number.precision')
        ),
    duration_mins: Joi.number().integer().min(15).max(480),
    status: Joi.string().valid('active', 'paused'),
};

export const createServicePackageSchema = Joi.object({
    name: packageFields.name.required(),
    description: packageFields.description,
    price: packageFields.price.required(),
    duration_mins: packageFields.duration_mins.default(60),
    status: packageFields.status.default('active'),
})
    .unknown(false)
    .required();

export const updateServicePackageSchema = Joi.object(packageFields)
    .unknown(false)
    .required()
    .min(1);

export const servicePackageParamsSchema = Joi.object({
    serviceId: id.required(),
    packageId: id.optional(),
})
    .unknown(false)
    .required();
