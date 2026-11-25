import Payout from '#models/payout.model.js';

const INTERVAL_MS = Math.max(
    30_000,
    Number(process.env.PAYOUT_WORKER_INTERVAL_MS || 60_000)
);

export function startPayoutWorker() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await Payout.runDueAutomatic();
        } catch (error) {
            console.error('Payout worker failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, INTERVAL_MS);
    timer.unref?.();
    void run();
    return () => clearInterval(timer);
}

