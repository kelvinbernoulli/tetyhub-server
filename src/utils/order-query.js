import { orderDetailQuerySchema, orderListQuerySchema } from '#schemas/order-query.schema.js';

export const parseOrderListQuery = (query, scope) => {
    const { error, value } = orderListQuerySchema.validate(query, {
        abortEarly: false,
        convert: true,
    });

    if (error) {
        return { error: error.details.map((detail) => detail.message).join('; ') };
    }

    if (scope !== 'admin' && value.vendor_id !== undefined) {
        return { error: 'vendor_id is only available for admin order searches' };
    }
    if (scope === 'customer' && value.fulfillment_status) {
        return { error: 'Customers can filter by order status, not vendor fulfillment status' };
    }
    if (scope === 'vendor' && value.status && value.order_status && value.status !== value.order_status) {
        return { error: 'For vendors, use status for fulfillment and order_status for the overall order status' };
    }
    if (scope !== 'vendor' && value.status && value.order_status && value.status !== value.order_status) {
        return { error: 'status and order_status cannot conflict' };
    }

    const filters = { ...value };
    if (scope === 'vendor') {
        filters.fulfillment_status ??= filters.status;
    } else {
        filters.order_status ??= filters.status;
    }
    delete filters.status;

    return { value: filters };
};

export const parseOrderDetailQuery = (query) => {
    const { error, value } = orderDetailQuerySchema.validate(query, {
        abortEarly: false,
        convert: true,
    });
    if (error) {
        return { error: error.details.map((detail) => detail.message).join('; ') };
    }
    return {
        value: value.include === 'all'
            ? ['items', 'shipping_address', 'fulfillments']
            : value.include.split(','),
    };
};
