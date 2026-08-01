import Joi from "joi";

export const createAdminTypeSchema = Joi.object({
    admin_type: Joi.string().trim().min(2).max(50).required().label("Role Name"),
    vendor_id: Joi.number().integer().positive().optional().label("Vendor ID"),
    description: Joi.string().trim().max(255).optional().label("Role Description"),
});

export const updateAdminTypeSchema = Joi.object({
    admin_type: Joi.string().trim().min(2).max(50).optional().label("Role Name"),
    status: Joi.boolean().optional().label("Status"),
    description: Joi.string().trim().max(255).optional().label("Role Description"),
}).min(1);

export default {
    createAdminTypeSchema,
    updateAdminTypeSchema,
};