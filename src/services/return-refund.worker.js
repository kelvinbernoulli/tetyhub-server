import Payment from '#models/payment.model.js';

export function startReturnRefundWorker({ intervalMs = 60_000 } = {}) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await Payment.reconcileReturnRefunds();
        } catch (error) {
            console.error('Return refund reconciliation worker failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    void run();
    return () => clearInterval(timer);
}
