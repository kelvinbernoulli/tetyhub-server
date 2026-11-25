import Joi from 'joi';
import { minorUnits } from '#utils/checkout.js';

export const payoutPreferencesSchema = Joi.object({
    mode: Joi.string().valid('manual', 'automatic').required(),
    interval: Joi.when('mode', {
        is: 'automatic',
        then: Joi.string().valid('weekly', 'bi_weekly', 'monthly').required(),
        otherwise: Joi.string().valid('weekly', 'bi_weekly', 'monthly').forbidden(),
    }),
}).required().options({ allowUnknown: false, stripUnknown: false });

export const payoutAccountSchema = Joi.object({
    account_number: Joi.string().pattern(/^\d{10}$/).required(),
    bank_code: Joi.string().trim().pattern(/^[A-Za-z0-9_-]{2,15}$/).required(),
}).required().options({ allowUnknown: false, stripUnknown: false });

export const payoutRequestSchema = Joi.object({
    // Optional amount in naira; omitting it requests the full eligible balance.
    amount: Joi.string()
        .pattern(/^\d+(\.\d{1,2})?$/)
        .custom((value, helpers) => {
            try {
                minorUnits(value);
                return value;
            } catch {
                return helpers.error('any.invalid');
            }
        })
        .messages({ 'any.invalid': 'amount must be a valid naira amount with up to two decimal places' })
        .optional(),
}).required().options({ allowUnknown: false, stripUnknown: false });

export const taxDeductionSchema = Joi.object({
    amount: Joi.string()
        .pattern(/^\d+(\.\d{1,2})?$/)
        .custom((value, helpers) => {
            try {
                minorUnits(value);
                if (minorUnits(value) <= 0) return helpers.error('any.invalid');
                return value;
            } catch {
                return helpers.error('any.invalid');
            }
        })
        .messages({ 'any.invalid': 'amount must be a positive naira amount with up to two decimal places' })
        .required(),
    note: Joi.string().trim().min(3).max(300).required(),
}).required().options({ allowUnknown: false, stripUnknown: false });

export const payoutListSchema = Joi.object({
    status: Joi.string().valid('pending', 'processing', 'paid', 'failed', 'reversed').optional(),
    limit: Joi.number().integer().min(1).max(100).default(40),
    offset: Joi.number().integer().min(0).max(2147483647).default(0),
}).options({ allowUnknown: false, stripUnknown: false });
