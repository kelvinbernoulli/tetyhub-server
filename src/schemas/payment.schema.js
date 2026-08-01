import Joi from "joi";

export const refundSchema = Joi.object({
    order_id:   Joi.number().integer().positive().required().label("Order ID"),
    amount:     Joi.number().precision(2).positive().required().label("Refund Amount"),
    reason:     Joi.string().trim().max(500).optional().label("Reason"),
});