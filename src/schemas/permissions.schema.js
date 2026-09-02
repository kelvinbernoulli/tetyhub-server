import Joi from 'joi';

const grantSchema = Joi.object({
    admin_type_id: Joi.number().integer().positive().optional().label('Permission type ID'),
    resource: Joi.string()
        .trim()
        .lowercase()
        .pattern(/^[a-z][a-z0-9.-]{1,63}$/)
        .optional()
        .label('Permission resource'),
    can_create: Joi.boolean().default(false),
    can_read: Joi.boolean().default(false),
    can_update: Joi.boolean().default(false),
    can_delete: Joi.boolean().default(false),
    expires_at: Joi.date().iso().greater('now').allow(null).optional(),
})
    .xor('admin_type_id', 'resource')
    .unknown(false);

export const replaceAdminPermissionsSchema = Joi.object({
    version: Joi.number().integer().min(1).required().label('Authorization version'),
    grants: Joi.array().items(grantSchema).max(100).required().label('Permission grants'),
}).unknown(false);

export default { replaceAdminPermissionsSchema };
