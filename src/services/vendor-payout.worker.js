import { processPendingTransfers, scheduleDuePayoutBatches } from '#services/vendor-payout.service.js';

export function startVendorPayoutWorker({ intervalMs = 5 * 60 * 1000 } = {}) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await scheduleDuePayoutBatches();
            await processPendingTransfers();
        } catch (error) {
            console.error('Vendor payout worker failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    void run();
    return () => clearInterval(timer);
}