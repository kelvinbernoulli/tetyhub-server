import Joi from 'joi';
import { PERMISSION_SCOPES } from '#utils/access-control.js';

const resourceCode = Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z][a-z0-9.-]{1,63}$/);

export const createAdminTypeSchema = Joi.object({
    admin_type: Joi.string().trim().min(2).max(80).required().label('Name'),
    resource: resourceCode.required().label('Resource code'),
    scope: Joi.string()
        .valid(...Object.values(PERMISSION_SCOPES))
        .required()
        .label('Scope'),
    status: Joi.boolean().valid(true, false).default(true).label('Status'),
    description: Joi.string().trim().max(255).allow(null, '').optional(),
}).unknown(false);

export const updateAdminTypeSchema = Joi.object({
    admin_type: Joi.string().trim().min(2).max(80).optional().label('Name'),
    resource: resourceCode.optional().label('Resource code'),
    scope: Joi.string()
        .valid(...Object.values(PERMISSION_SCOPES))
        .optional()
        .label('Scope'),
    status: Joi.boolean().valid(true, false).optional().label('Status'),
    description: Joi.string().trim().max(255).allow(null, '').optional(),
}).min(1).unknown(false);

export default {
    createAdminTypeSchema,
    updateAdminTypeSchema,
};
