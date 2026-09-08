export const serviceError = (message, status = 422) =>
    Object.assign(new Error(message), { status });

// Keep the legacy boolean consistent with the canonical location type.
export function normalizeServiceState(data, existing = {}, creating = false) {
    const result = { ...data };
    if (data.location_type !== undefined) {
        const remote = data.location_type === 'remote';
        if (data.is_remote !== undefined && data.is_remote !== remote)
            throw serviceError('is_remote must agree with location_type');
        result.is_remote = remote;
    } else if (data.is_remote !== undefined) {
        result.location_type = data.is_remote
            ? 'remote'
            : existing.location_type === 'customer_location'
              ? 'customer_location'
              : 'vendor_location';
    } else if (creating) {
        result.location_type = 'vendor_location';
        result.is_remote = false;
    }
    const merged = { ...existing, ...result };
    if (
        merged.base_price !== undefined &&
        merged.compare_at_price != null &&
        Number(merged.compare_at_price) <= Number(merged.base_price)
    ) {
        throw serviceError(
            'Compare-at price must be higher than the base price'
        );
    }
    return result;
}
