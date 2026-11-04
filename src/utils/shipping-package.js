export function parseStoredDimensions(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const parsed = {
            length: Number(value.length),
            width: Number(value.width),
            height: Number(value.height),
        };
        return Object.values(parsed).every(Number.isFinite) ? parsed : null;
    }
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object')
            return parseStoredDimensions(parsed);
    } catch {
        // Support legacy dimension strings such as "12 x 10 x 20".
    }
    const sides = value.match(/\d+(?:\.\d+)?/g)?.map(Number);
    if (!sides || sides.length < 3) return null;
    return { length: sides[0], width: sides[1], height: sides[2] };
}

export function itemShippingData(item) {
    const legacyVariant = parseStoredDimensions(item.variant_dimensions);
    return {
        weight: Number(item.variant_weight ?? item.weight),
        dimensions: {
            length: Number(item.variant_length ?? legacyVariant?.length ?? item.length),
            width: Number(item.variant_width ?? legacyVariant?.width ?? item.width),
            height: Number(item.variant_height ?? legacyVariant?.height ?? item.height),
        },
    };
}

export function shippingPackageGroupKey(vendorId, categoryId) {
    return `${vendorId}:${categoryId}`;
}

export function groupShippingItems(items) {
    const groups = new Map();
    for (const item of items) {
        if (item.is_digital) continue;
        const categoryId = Number(item.shipbubble_category_id);
        if (!Number.isSafeInteger(categoryId) || categoryId <= 0) continue;
        const key = shippingPackageGroupKey(item.vendor_id, categoryId);
        if (!groups.has(key)) {
            groups.set(key, {
                package_group_key: key,
                vendor_id: Number(item.vendor_id),
                category_id: categoryId,
                items: [],
            });
        }
        groups.get(key).items.push(item);
    }
    return [...groups.values()].filter((group) =>
        group.items.some((item) => !item.free_shipping)
    );
}

export function calculateParcel(items, paddingCm = 2) {
    const units = items.map((item) => {
        const { weight, dimensions } = itemShippingData(item);
        const sides = [dimensions.length, dimensions.width, dimensions.height];
        if (!Number.isFinite(weight) || weight <= 0 ||
            sides.some((side) => !Number.isFinite(side) || side <= 0 || side > 500))
            return null;
        return {
            sides: sides.sort((a, b) => a - b),
            quantity: Number(item.quantity),
            weight,
        };
    });
    if (units.some((item) => !item || !Number.isInteger(item.quantity) || item.quantity < 1))
        return null;

    // Compare three valid stacking orientations and use the smallest bounding carton.
    // The 2 cm total allowance adds roughly 1 cm of packaging on each side.
    const candidates = [0, 1, 2].map((stackAxis) => {
        const dimensions = [0, 0, 0];
        for (const unit of units) {
            dimensions[stackAxis] += unit.sides[stackAxis] * unit.quantity;
            for (let axis = 0; axis < 3; axis++) {
                if (axis !== stackAxis)
                    dimensions[axis] = Math.max(dimensions[axis], unit.sides[axis]);
            }
        }
        return dimensions.map((side) => side + paddingCm);
    });
    const packageDimensions = candidates
        .filter((sides) => sides.every((side) => Number.isFinite(side) && side <= 500))
        .sort((a, b) => a.reduce((v, side) => v * side, 1) - b.reduce((v, side) => v * side, 1))[0];
    if (!packageDimensions) return null;

    return {
        package_dimension: {
            length: packageDimensions[0],
            width: packageDimensions[1],
            height: packageDimensions[2],
        },
        total_weight: units.reduce((sum, unit) => sum + unit.weight * unit.quantity, 0),
    };
}
