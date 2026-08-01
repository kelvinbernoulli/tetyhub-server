import Joi from "joi";

const phoneRegex = /^(\+234|0)[789][01]\d{8}$/;

export const createAdminSchema = Joi.object({
    firstname: Joi.string().trim().min(2).max(100).required().label("First name"),
    lastname: Joi.string().trim().min(2).max(100).required().label("Last name"),
    email: Joi.string().email().lowercase().required().label("Email"),
    phone: Joi.string()
        .trim()
        .pattern(phoneRegex)
        .required()
        .label("Phone")
        .messages({
            "string.pattern.base":
                "Phone must be a valid international number format.",
        }),
    country_id: Joi.number().integer().positive().required().label("Country ID"),
    vendor_id: Joi.number().integer().positive().optional().label("Vendor ID"),
});

export const updateAdminSchema = Joi.object({
    firstname: Joi.string().trim().min(2).max(100).optional().label("First Name"),
    lastname: Joi.string().trim().min(2).max(100).optional().label("Last Name"),
    email: Joi.string().email().lowercase().optional().label("Email"),
    phone: Joi.string()
        .trim()
        .pattern(phoneRegex)
        .optional()
        .label("Phone")
        .messages({
            "string.pattern.base": "Phone must be a valid international number format.",
        })
}).min(1);

const adminPermissionsSchema = Joi.object({
    sub_role: Joi.array().items(Joi.number().integer().min(1)).optional(),
    status: Joi.boolean().valid(true, false).optional(),
    permission: Joi.object()
        .pattern(
            Joi.string().regex(/^\d+$/),
            Joi.object({
                create: Joi.boolean(),
                read: Joi.boolean(),
                update: Joi.boolean(),
                delete: Joi.boolean()
            }).min(1).required()
        )
        .optional()
}).min(1);

export default {
    createAdminSchema,
    updateAdminSchema,
    adminPermissionsSchema
};
