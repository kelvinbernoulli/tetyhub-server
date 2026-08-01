import Joi from "joi";

export const addToCartSchema = Joi.object({
    product_id: Joi.number().integer().positive().required().label("Product ID"),
    variant_id: Joi.number().integer().positive().optional().label("Variant ID"),
    quantity:   Joi.number().integer().min(1).max(100).default(1).optional().label("Quantity"),
}).min(1);

export const upsertCartSchema = Joi.object({
    product_id: Joi.number().integer().positive().required().label("Product ID"),
    variant_id: Joi.number().integer().positive().optional().label("Variant ID"),
    quantity:   Joi.number().integer().min(1).max(100).optional().label("Quantity"),
});

export const checkoutSchema = Joi.object({
    shipping_address_id:    Joi.number().integer().positive().optional().label("Shipping Address ID"),
    shipping_address:       Joi.object({
        firstname:  Joi.string().trim().max(100).required().label("First Name"),
        lastname:   Joi.string().trim().max(100).required().label("Last Name"),
        phone:      Joi.string().trim().pattern(/^\+?[1-9]\d{1,14}$/).required().label("Phone"),
        address:    Joi.string().trim().max(500).required().label("Address"),
        city:       Joi.string().trim().max(100).required().label("City"),
        state:      Joi.string().trim().max(100).required().label("State"),
        country:    Joi.string().trim().max(100).required().label("Country"),
        zip_code:   Joi.string().trim().max(20).optional().label("Zip Code"),
    }).optional(),
    gateway:        Joi.string().valid('paystack', 'stripe').default('paystack').required().label("Payment Gateway"),
    note:           Joi.string().trim().max(500).optional().label("Order Note"),
    coupon_code:    Joi.string().trim().max(50).optional().label("Coupon Code"),
}).or('shipping_address_id', 'shipping_address');

export default {
    addToCartSchema,
    upsertCartSchema,
    checkoutSchema
}