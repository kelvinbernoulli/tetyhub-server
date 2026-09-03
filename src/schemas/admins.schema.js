import Joi from 'joi';
import { ADMIN_STATUSES } from '#utils/access-control.js';

const e164Phone = /^\+[1-9]\d{7,14}$/;
const strongPassword = Joi.string()
    .min(8)
    .max(128)
    .pattern(/[a-z]/, 'lowercase character')
    .pattern(/[A-Z]/, 'uppercase character')
    .pattern(/[0-9]/, 'number')
    .pattern(/[^A-Za-z0-9]/, 'special character');

export const createAdminSchema = Joi.object({
    firstname: Joi.string().trim().min(2).max(100).required().label('First name'),
    lastname: Joi.string().trim().min(2).max(100).required().label('Last name'),
    email: Joi.string().trim().email().lowercase().max(320).required().label('Email'),
    phone: Joi.string()
        .trim()
        .pattern(e164Phone)
        .optional()
        .label('Phone')
        .messages({
            'string.pattern.base': 'Phone must use E.164 format, for example +2348012345678.',
        }),
    country_id: Joi.number().integer().positive().optional().label('Country ID'),
}).unknown(false);

export const updateAdminSchema = Joi.object({
    firstname: Joi.string().trim().min(2).max(100).optional().label('First name'),
    lastname: Joi.string().trim().min(2).max(100).optional().label('Last name'),
    phone: Joi.string()
        .trim()
        .pattern(e164Phone)
        .allow(null)
        .optional()
        .label('Phone')
        .messages({
            'string.pattern.base': 'Phone must use E.164 format, for example +2348012345678.',
        }),
    country_id: Joi.number().integer().positive().allow(null).optional().label('Country ID'),
    status: Joi.string()
        .valid(ADMIN_STATUSES.ACTIVE, ADMIN_STATUSES.SUSPENDED)
        .optional()
        .label('Admin status'),
}).min(1).unknown(false);

export const acceptAdminInvitationSchema = Joi.object({
    token: Joi.string().trim().min(32).max(512).required().label('Invitation token'),
    password: strongPassword.required().label('Password'),
    password_confirmation: Joi.string()
        .valid(Joi.ref('password'))
        .required()
        .label('Password confirmation')
        .messages({ 'any.only': 'Password confirmation must match password.' }),
}).unknown(false);

export default {
    createAdminSchema,
    updateAdminSchema,
    acceptAdminInvitationSchema,
};
