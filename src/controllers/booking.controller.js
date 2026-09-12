import Booking from '#models/booking.model.js';
import BookingPayment from '#models/booking-payment.model.js';
import {
    bookingIdSchema,
    createBookingSchema,
    availabilitySchema,
    bookingListSchema,
    cancelBookingSchema,
    bookingStatusSchema,
} from '#schemas/booking.schema.js';
import { CheckoutError } from '#utils/checkout.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const validate = (schema, data) => {
    const { value, error } = schema.validate(data);
    if (error) throw new CheckoutError(error.details[0].message, 400);
    return value;
};
const owner = (req, vendor = false) => {
    const id = vendor ? req.auth?.vendorId : req.auth?.userId;
    if (!Number.isInteger(id) || id < 1)
        throw new CheckoutError('Authentication required', vendor ? 403 : 401);
    return id;
};
const id = (req) => validate(bookingIdSchema, req.params.bookingId);
const endpoint =
    (work, message, status = 200) =>
    async (req, res) => {
        try {
            const result = await work(req);
            if (result == null)
                throw new CheckoutError('Booking not found', 404);
            return respondWithSuccess(res, status, message, result);
        } catch (error) {
            const code = error instanceof CheckoutError ? error.code : 500;
            if (code >= 500)
                console.error('Booking request failed:', error.message);
            return respondWithError(
                res,
                code,
                code < 500
                    ? error.message
                    : 'Booking request failed; retry shortly',
                code === 404
                    ? ERROR_CODES.RESOURCE_NOT_FOUND
                    : code === 409
                      ? ERROR_CODES.RESOURCE_CONFLICT
                      : code >= 500
                        ? ERROR_CODES.INTERNAL_SERVER_ERROR
                        : ERROR_CODES.VALIDATION_ERROR
            );
        }
    };
export const availability = endpoint(
    (req) =>
        Booking.availability(
            validate(bookingIdSchema, req.params.serviceId),
            validate(availabilitySchema, req.query).scheduled_for
        ),
    'Availability retrieved'
);
export const create = endpoint(
    (req) =>
        Booking.create(owner(req), validate(createBookingSchema, req.body)),
    'Booking reserved; complete payment before expiry',
    201
);
export const list = endpoint(
    (req) =>
        Booking.list(owner(req), false, validate(bookingListSchema, req.query)),
    'Bookings retrieved'
);
export const view = endpoint(
    (req) => Booking.view(id(req), owner(req)),
    'Booking retrieved'
);
export const cancel = endpoint(
    (req) =>
        Booking.change(
            id(req),
            owner(req),
            false,
            validate(cancelBookingSchema, req.body)
        ),
    'Booking cancelled'
);
export const pay = endpoint(
    (req) => BookingPayment.initiate(owner(req), id(req)),
    'Booking payment initialized'
);
export const vendorList = endpoint(
    (req) =>
        Booking.list(
            owner(req, true),
            true,
            validate(bookingListSchema, req.query)
        ),
    'Bookings retrieved'
);
export const vendorView = endpoint(
    (req) => Booking.view(id(req), owner(req, true), true),
    'Booking retrieved'
);
export const vendorCancel = endpoint(
    (req) =>
        Booking.change(
            id(req),
            owner(req, true),
            true,
            validate(cancelBookingSchema, req.body)
        ),
    'Booking cancelled'
);
export const vendorStatus = endpoint(
    (req) =>
        Booking.change(
            id(req),
            owner(req, true),
            true,
            validate(bookingStatusSchema, req.body)
        ),
    'Booking status updated'
);
