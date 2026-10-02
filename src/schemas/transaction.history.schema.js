import Joi from 'joi';

export const transactionIdSchema = Joi.string().pattern(/^[1-9]\d*$/).custom((value, helpers) => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id <= 2147483647 ? id : helpers.error('any.invalid');
}).required();

const filters = {
    offset: Joi.number().integer().min(0).max(2147483647).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid('pending', 'success', 'completed', 'failed', 'cancelled', 'refunded'),
    payment_status: Joi.string().valid('unpaid', 'paid', 'refunded', 'partially_refunded'),
    type: Joi.string().valid('order', 'booking'),
};

export const transactionQuerySchema = Joi.object(filters);
export const adminTransactionQuerySchema = Joi.object({
    ...filters,
    vendor_id: transactionIdSchema.optional(),
});
