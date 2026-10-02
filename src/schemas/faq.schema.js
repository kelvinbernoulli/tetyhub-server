import Joi from "joi";

export const createFAQSchema = Joi.object({
    question: Joi.string().max(1500).required().label('Question'),
    answer: Joi.string().max(2000).required().label('Answer'),
    status: Joi.bool().valid(true, false).required().label('Status')
})

export const updateFAQSchema = Joi.object({
    question: Joi.string().max(1500).optional().label('Question'),
    answer: Joi.string().max(2000).optional().label('Answer'),
    status: Joi.bool().valid(true, false).optional().label('Status')
}).min(1)