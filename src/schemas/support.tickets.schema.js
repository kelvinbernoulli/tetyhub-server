import { base64ImagePattern } from "#utils/helpers.js";
import Joi from "joi";


export const supportTicketSchema = Joi.object({
    subject: Joi.string().min(3).max(200).required().messages({
        'string.empty': 'Subject is required.',
    }).label('Subject'),
    priority: Joi.string().valid('low', 'medium', 'high').required().messages({
        'any.only': 'Priority must be one of low, medium, or high.',
        'string.empty': 'Priority is required.',
    }).label('Priority'),
    message: Joi.string().required().messages({
        'string.empty': 'Message is required.',
    }).label('Message'),
    attachment: Joi.string().pattern(base64ImagePattern).optional().messages({
        'string.pattern.base': 'Invalid file format. Allowed formats are png, jpg, jpeg, and pdf.',
        'string.empty': 'File cannot be empty.',
    }).label('Attachment')
}).min(1);

export const ticketReplySchema = Joi.object({
    message: Joi.string().max(500).optional().label('Message'),
    attachment: Joi.string().pattern(base64ImagePattern).optional().messages({
        'string.pattern.base': 'Invalid file format. Allowed formats are png, jpg, jpeg, and pdf.',
        'string.empty': 'File cannot be empty.',
    }).label('Attachment')
}).min(1);

export default {
    supportTicketSchema,
    ticketReplySchema
};