import Order from '#models/order.model.js';

const DELIVERY_CONFIRMATION_GRACE_PERIOD_DAYS = 7;

export function startVendorDeliveryConfirmationWorker({ intervalMs = 60_000 } = {}) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await Order.autoConfirmDeliveredFulfillments({
                gracePeriodDays: DELIVERY_CONFIRMATION_GRACE_PERIOD_DAYS,
            });
        } catch (error) {
            console.error('Automatic delivery confirmation worker failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    void run();
    return () => clearInterval(timer);
}
