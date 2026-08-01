import { base64ImagePattern } from "#utils/helpers.js";
import Joi from "joi";

export const settingsSchema = Joi.object({
    site_name: Joi.string().trim().optional().label('Site Name'),
    logo: Joi.string().pattern(base64ImagePattern).optional().label('Logo'),
    phone_one: Joi.string().trim().optional().label('Phone One'),
    phone_two: Joi.string().trim().optional().label('Phone Two'),
    email: Joi.string().email().trim().optional().label('Email'),
    facebook: Joi.string().uri().optional().label('Facebook Url'),
    twitter: Joi.string().uri().optional().label('X Url'),
    instagram: Joi.string().uri().optional().label('Instagram Url'),
    whatsapp: Joi.string().uri().optional().label('WhatsApp Url'),
    linkedin: Joi.string().uri().optional().label('LinkedIn Url'),
    snapchat: Joi.string().uri().optional().label('Snapchat Url'),
    terms_and_condition: Joi.string().trim().optional().label('Terms and Conditions'),
    privacy_policy: Joi.string().trim().optional().label('Privacy Policy'),
}).min(1);

export default settingsSchema;