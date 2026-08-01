import Joi from "joi";

export const orderSchema = Joi.object({
    note: Joi.string().trim().max(500).optional().label("Order Note"),
    shipping_address: Joi.object({
        firstname:  Joi.string().trim().max(100).required().label("First Name"),
        lastname:   Joi.string().trim().max(100).required().label("Last Name"),
        phone:      Joi.string().trim().pattern(/^(\+?\d{1,3}[-.\s]?)?\(?\d{1,4}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/).required().label("Phone"),
        address:    Joi.string().trim().max(500).required().label("Address"),
        city:       Joi.string().trim().max(100).required().label("City"),
        state:      Joi.string().trim().max(100).required().label("State"),
        country:    Joi.string().trim().max(100).required().label("Country"),
        zip_code:   Joi.string().trim().max(20).optional().label("Zip Code"),
    }).required().label("Shipping Address"),
});

export const updateOrderStatusSchema = Joi.object({
    status: Joi.string()
        .valid('pending', 'processing', 'awaiting_shipment', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'refunded')
        .required()
        .label("Status"),
    note: Joi.string().trim().max(500).optional().label("Note"),
});

export const cancelOrderSchema = Joi.object({
    reason: Joi.string().trim().max(500).required().label("Cancellation Reason"),
});

export const createShipmentSchema = Joi.object({
    tracking_number: Joi.string().trim().max(100).required().label("Tracking Number"),
    carrier: Joi.string().trim().max(100).required().label("Carrier"),
    shipping_method: Joi.string().trim().max(100).optional().label("Shipping Method"),
    estimated_delivery: Joi.date().optional().label("Estimated Delivery Date"),
    shipping_cost: Joi.number().min(0).optional().label("Shipping Cost"),
    notes: Joi.string().trim().max(500).optional().label("Notes"),
});

export const updateShipmentSchema = Joi.object({
    tracking_number: Joi.string().trim().max(100).optional().label("Tracking Number"),
    carrier: Joi.string().trim().max(100).optional().label("Carrier"),
    shipping_method: Joi.string().trim().max(100).optional().label("Shipping Method"),
    estimated_delivery: Joi.date().optional().label("Estimated Delivery Date"),
    shipping_cost: Joi.number().min(0).optional().label("Shipping Cost"),
    status: Joi.string().valid('pending', 'shipped', 'in_transit', 'delivered', 'failed').optional().label("Shipment Status"),
    notes: Joi.string().trim().max(500).optional().label("Notes"),
    location: Joi.string().trim().max(255).optional().label("Location"),
    tracking_description: Joi.string().trim().max(500).optional().label("Tracking Description"),
});

export const addTrackingUpdateSchema = Joi.object({
    status: Joi.string().valid('pending', 'processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'cancelled', 'failed').required().label("Status"),
    location: Joi.string().trim().max(255).optional().label("Location"),
    description: Joi.string().trim().max(500).optional().label("Description"),
});

export const createReturnRequestSchema = Joi.object({
    reason: Joi.string().trim().max(500).required().label("Return Reason"),
    description: Joi.string().trim().max(1000).optional().label("Description"),
    return_type: Joi.string().valid('refund', 'exchange', 'store_credit').required().label("Return Type"),
    refund_amount: Joi.number().min(0).optional().label("Refund Amount"),
    items: Joi.array().items(
        Joi.object({
            order_item_id: Joi.number().integer().positive().required().label("Order Item ID"),
            quantity: Joi.number().integer().min(1).required().label("Quantity"),
            condition: Joi.string().trim().max(255).optional().label("Item Condition"),
        })
    ).min(1).required().label("Return Items"),
});

export const updateReturnStatusSchema = Joi.object({
    status: Joi.string().valid('pending', 'approved', 'rejected', 'awaiting_pickup', 'item_received', 'processing', 'completed', 'cancelled').required().label("Return Status"),
    vendor_notes: Joi.string().trim().max(1000).optional().label("Vendor Notes"),
});

export const adminUpdateReturnSchema = Joi.object({
    status: Joi.string().valid('pending', 'approved', 'rejected', 'awaiting_pickup', 'item_received', 'processing', 'completed', 'cancelled').optional().label("Return Status"),
    admin_notes: Joi.string().trim().max(1000).optional().label("Admin Notes"),
    evidence: Joi.array().items(
        Joi.object({
            type: Joi.string().valid('image', 'video', 'document').required(),
            url: Joi.string().uri().required(),
            description: Joi.string().trim().max(255).optional(),
        })
    ).optional().label("Evidence"),
});

export const processRefundSchema = Joi.object({
    amount: Joi.number().min(0).required().label("Refund Amount"),
    reason: Joi.string().trim().max(500).required().label("Refund Reason"),
    refund_method: Joi.string().valid('original_payment', 'store_credit').optional().default('original_payment').label("Refund Method"),
});

export default {
    orderSchema,
    updateOrderStatusSchema,
    cancelOrderSchema,
    createShipmentSchema,
    updateShipmentSchema,
    addTrackingUpdateSchema,
    createReturnRequestSchema,
    updateReturnStatusSchema,
    adminUpdateReturnSchema,
    processRefundSchema,
};