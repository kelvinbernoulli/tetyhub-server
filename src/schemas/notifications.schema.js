import Joi from 'joi';

export const notificationQuerySchema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    unread_only: Joi.boolean().default(false),
    type: Joi.string().trim().max(80),
    before: Joi.number().integer().positive().max(2147483647),
});

export const notificationReadSchema = Joi.object({
    through_id: Joi.number().integer().positive().max(2147483647),
});
