import { CheckoutError, minorUnits, majorUnits } from './checkout.js';

export function bookingTimes(scheduled, duration, now = new Date()) {
    const start = new Date(scheduled);
    if (
        !Number.isFinite(start.getTime()) ||
        start <= now ||
        start - now > 366 * 86400000
    )
        throw new CheckoutError(
            'Choose a future booking time within one year',
            400
        );
    if (!Number.isInteger(duration) || duration < 1)
        throw new CheckoutError('Service duration is invalid', 409);
    return { start, end: new Date(start.getTime() + duration * 60000) };
}

// Half-open intervals allow one session to start when another session's buffer ends.
export function remainingCapacity(bookings, start, end, capacity) {
    const events = [];
    for (const booking of bookings) {
        const from = Math.max(+start, +new Date(booking.scheduled_for));
        const to = Math.min(
            +end,
            +new Date(booking.ends_at) + booking.buffer_mins * 60000
        );
        if (from < to) events.push([from, 1], [to, -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let used = 0,
        peak = 0;
    for (const [, delta] of events) peak = Math.max(peak, (used += delta));
    return Math.max(0, capacity - peak);
}

export function cancellationRefund(booking, byVendor, now = new Date()) {
    if (booking.payment_status !== 'paid') return '0.00';
    const total = minorUnits(booking.total);
    const late =
        new Date(booking.scheduled_for) - now <
        booking.cancellation_window_hours * 3600000;
    const fee =
        !byVendor && late
            ? Math.round((total * booking.cancellation_fee_percent) / 100)
            : 0;
    return majorUnits(total - fee);
}

export function bookingPayable(booking, now = new Date()) {
    return (
        booking.booking_status === 'pending' &&
        booking.payment_status === 'unpaid' &&
        booking.reservation_expires_at &&
        new Date(booking.reservation_expires_at) > now &&
        new Date(booking.scheduled_for) > now
    );
}
