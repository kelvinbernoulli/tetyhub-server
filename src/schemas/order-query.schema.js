import Joi from 'joi';

const orderStatuses = [
    'pending',
    'processing',
    'awaiting_shipment',
    'packed',
    'shipped',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'refunded',
    'payment_review',
];

const fulfillmentStatuses = orderStatuses.filter((status) => status !== 'payment_review');
const paymentStatuses = ['unpaid', 'paid', 'refunded', 'partially_refunded'];
const sortFields = ['created_at', 'updated_at', 'total', 'order_number'];

export const orderListQuerySchema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid(...orderStatuses),
    order_status: Joi.string().valid(...orderStatuses),
    fulfillment_status: Joi.string().valid(...fulfillmentStatuses),
    payment_status: Joi.string().valid(...paymentStatuses),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    q: Joi.string().trim().min(1).max(100),
    sort_by: Joi.string().valid(...sortFields).default('created_at'),
    sort_order: Joi.string().lowercase().valid('asc', 'desc').default('desc'),
    vendor_id: Joi.number().integer().positive(),
}).custom((query, helpers) => {
    if (query.from && query.to && query.from > query.to) {
        return helpers.error('any.invalid', { message: '`from` must be earlier than or equal to `to`' });
    }
    return query;
}).unknown(false);

const detailIncludes = ['items', 'shipping_address', 'fulfillments'];
export const orderDetailQuerySchema = Joi.object({
    include: Joi.string().trim().max(100).default('all').custom((value, helpers) => {
        if (value === 'all') return value;
        const requested = value.split(',').map((part) => part.trim()).filter(Boolean);
        if (!requested.length || requested.some((part) => !detailIncludes.includes(part))) {
            return helpers.error('any.only', { valids: ['all', ...detailIncludes] });
        }
        if (new Set(requested).size !== requested.length) {
            return helpers.error('any.invalid');
        }
        return requested.join(',');
    }),
}).unknown(false);

