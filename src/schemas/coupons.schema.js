import Joi from 'joi';

export const createCouponSchema = Joi.object({
    code: Joi.string().trim().min(3).max(50).required().label('Coupon Code'),
    type: Joi.string().valid('percentage', 'fixed').required().label('Type'),
    value: Joi.number().precision(2).min(0).required().label('Value'),
    max_discount: Joi.number().precision(2).min(0).optional().allow(null).label('Max Discount'),
    min_order: Joi.number().precision(2).min(0).optional().default(0).label('Minimum Order'),
    usage_limit: Joi.number().integer().min(1).optional().allow(null).label('Usage Limit'),
    status: Joi.string().valid('active','inactive').optional().default('active').label('Status'),
    expires_at: Joi.date().optional().allow(null).label('Expiry Date'),
    description: Joi.string().trim().max(1000).optional().allow(null).label('Description')
}).options({ stripUnknown: true });

export const updateCouponSchema = Joi.object({
    code: Joi.string().trim().min(3).max(50).optional().label('Coupon Code'),
    type: Joi.string().valid('percentage', 'fixed').optional().label('Type'),
    value: Joi.number().precision(2).min(0).optional().label('Value'),
    max_discount: Joi.number().precision(2).min(0).optional().allow(null).label('Max Discount'),
    min_order: Joi.number().precision(2).min(0).optional().label('Minimum Order'),
    usage_limit: Joi.number().integer().min(1).optional().allow(null).label('Usage Limit'),
    status: Joi.string().valid('active','inactive').optional().label('Status'),
    expires_at: Joi.date().optional().allow(null).label('Expiry Date'),
    description: Joi.string().trim().max(1000).optional().allow(null).label('Description')
}).options({ stripUnknown: true });

export default { createCouponSchema, updateCouponSchema };
