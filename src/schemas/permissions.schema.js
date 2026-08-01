import Joi from "joi";

export const adminPermissionsSchema = Joi.object({
    admin_id: Joi.number().integer().positive().required().label("Admin ID"),
    admin_roles: Joi.array().items(Joi.number().integer().min(1)).required().label("Admin Roles"),
    permissions: Joi.object().pattern(
        Joi.number().integer().min(1),
        Joi.object({
            can_create: Joi.boolean().optional().default(false).label("Create"),
            can_read: Joi.boolean().optional().default(false).label("Read"),
            can_update: Joi.boolean().optional().default(false).label("Update"),
            can_delete: Joi.boolean().optional().default(false).label("Delete"),
        }).min(1).required()
    ).required().label("Role Permissions"),
});