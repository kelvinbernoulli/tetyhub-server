import { base64ImagePattern } from "#utils/helpers.js";
import Joi from "joi";

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
const phoneRegex = /^(\+234|0)[789][01]\d{8}$/;

export const registerSchema = Joi.object({
    firstname: Joi.string().trim().min(2).max(100).required().label("First name"),
    lastname: Joi.string().trim().min(2).max(100).required().label("Last name"),
    email: Joi.string().email().lowercase().required().label("Email"),
    role: Joi.string().valid('customer', 'vendor').required().label("Role"),
    password: Joi.string()
        .pattern(passwordRegex)
        .required()
        .label("Password")
        .messages({
            "string.pattern.base":
                "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
        })
});

export const loginSchema = Joi.object({
    email: Joi.string().email().lowercase().required().label("Email"),
    password: Joi.string().required().label("Password")
});

export const updateProfileSchema = Joi.object({
    firstname:      Joi.string().trim().min(2).max(100).optional().label("First Name"),
    lastname:       Joi.string().trim().min(2).max(100).optional().label("Last Name"),
    phone:          Joi.string().trim().pattern(phoneRegex).optional().label("Phone"),
    gender:         Joi.string().valid('male', 'female', 'other').optional().label("Gender"),
    date_of_birth:  Joi.date().max('now').optional().label("Date of Birth"),
    avatar:         Joi.string().pattern(base64ImagePattern).optional().label("Avatar"),
}).min(1);

export const addAddressSchema = Joi.object({
    firstname:      Joi.string().trim().max(100).required().label("First Name"),
    lastname:       Joi.string().trim().max(100).required().label("Last Name"),
    phone:          Joi.string().trim().pattern(phoneRegex).required().label("Phone"),
    address:        Joi.string().trim().max(500).required().label("Address"),
    city:           Joi.string().trim().max(100).required().label("City"),
    state:          Joi.string().trim().max(100).required().label("State"),
    country:        Joi.string().trim().max(100).required().label("Country"),
    zip_code:       Joi.string().trim().max(20).optional().label("Zip Code"),
    is_default:     Joi.boolean().optional().label("Default Address"),
});

export const updateAddressSchema = addAddressSchema.fork(
    ['firstname', 'lastname', 'phone', 'address', 'city', 'state', 'country', 'zip_code', 'is_default'],
    (field) => field.optional()
).min(1);

export default {
    registerSchema,
    loginSchema,
    updateProfileSchema,
    addAddressSchema,
    updateAddressSchema
};