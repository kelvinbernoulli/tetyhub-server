import { createHash, randomUUID } from 'node:crypto';
import pool from '#services/pg_pool.js';
import Shipbubble from '#services/shipbubble.service.js';
import { CheckoutError, minorUnits } from '#utils/checkout.js';
import {
    shippingCartFingerprint,
    shippingDestinationFingerprint,
} from '#utils/shipping-address.js';
import {
    calculateParcel,
    groupShippingItems,
    itemShippingData,
} from '#utils/shipping-package.js';

const QUOTE_LIFETIME_HOURS = 24;

function addressKey(address) {
    return createHash('sha256')
        .update(
            JSON.stringify(
                Object.fromEntries(
                    Object.entries(address)
                        .map(([key, value]) => [key, String(value ?? '').trim().toLowerCase()])
                        .sort(([a], [b]) => a.localeCompare(b))
                )
            )
        )
        .digest('hex');
}

async function validatedAddress(address) {
    const hash = addressKey(address);
    const existing = await pool.query(
        `SELECT address_code, address_data FROM shipbubble_validated_addresses
         WHERE address_hash = $1`,
        [hash]
    );
    if (existing.rows[0]) return existing.rows[0];

    const response = await Shipbubble.validateAddress(address);
    const result = response?.data;
    if (!result?.address_code)
        throw new CheckoutError('ShipBubble could not validate a shipping address', 422);

    const saved = await pool.query(
        `INSERT INTO shipbubble_validated_addresses
            (address_hash, address_code, address_data)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (address_hash) DO UPDATE SET
            address_code = EXCLUDED.address_code,
            address_data = EXCLUDED.address_data,
            updated_at = NOW()
         RETURNING address_code, address_data`,
        [hash, String(result.address_code), JSON.stringify(result)]
    );
    return saved.rows[0];
}

function lagosDateTime(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function addCalendarDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export async function listShipbubblePackageCategories() {
    const response = await Shipbubble.listPackageCategories();
    return Array.isArray(response?.data) ? response.data : [];
}

export async function requestVendorShippingRates(userId, vendorId, data) {
    await pool.query(
        `DELETE FROM shipbubble_rate_quotes
         WHERE user_id = $1 AND order_id IS NULL AND expires_at <= NOW()`,
        [userId]
    );
    const { rows } = await pool.query(
        `SELECT ci.id AS cart_item_id, ci.quantity, p.id AS product_id,
                ci.variant_id, p.name, p.description,
                p.weight, p.length, p.width, p.height, p.price,
                p.shipbubble_category_id, p.free_shipping, p.is_digital,
                pv.dimensions AS variant_dimensions,
                pv.weight AS variant_weight,
                pv.length AS variant_length, pv.width AS variant_width,
                pv.height AS variant_height,
                COALESCE(pv.weight, p.weight) AS unit_weight,
                COALESCE(pv.price, p.price) AS unit_amount,
                v.id AS vendor_id, vs.store_name, vs.email AS vendor_email,
                vs.phone_one AS vendor_phone, vs.address AS vendor_address,
                vs.city AS vendor_city, vs.state AS vendor_state,
                vs.postal_code AS vendor_postal_code, co.name AS vendor_country,
                owner.email AS owner_email, owner.phone AS owner_phone
         FROM carts c
         JOIN cart_items ci ON ci.cart_id = c.id
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN product_variants pv
           ON pv.id = ci.variant_id AND pv.product_id = p.id
          AND pv.vendor_id = p.vendor_id AND pv.status = 'active'
         JOIN vendors v ON v.id = p.vendor_id
         LEFT JOIN vendor_settings vs ON vs.vendor_id = v.id
         JOIN users owner ON owner.id = v.user_id
         LEFT JOIN countries co ON co.id = vs.country_id
         WHERE c.user_id = $1 AND p.vendor_id = $2
           AND p.status = 'active' AND p.deleted_at IS NULL
           AND p.is_digital = false
           AND (ci.variant_id IS NULL OR pv.id IS NOT NULL)
         ORDER BY ci.id`,
        [userId, vendorId]
    );
    if (!rows.length)
        throw new CheckoutError(
            'No physical products from this vendor were found in your cart. Check the vendor ID and make sure the products are active.',
            404
        );

    const vendor = rows[0];
    if (!vendor.vendor_address || !vendor.vendor_city || !vendor.vendor_state || !vendor.vendor_country)
        throw new CheckoutError('Vendor pickup address is incomplete', 422);
    const sender = {
        name: vendor.store_name || 'Store',
        email: vendor.vendor_email || vendor.owner_email,
        phone: vendor.vendor_phone || vendor.owner_phone,
        address: [
            vendor.vendor_address,
            vendor.vendor_city,
            vendor.vendor_state,
            vendor.vendor_postal_code,
            vendor.vendor_country,
        ].filter(Boolean).join(', '),
    };
    const receiver = {
        name: `${data.firstname} ${data.lastname}`.trim(),
        email: data.email,
        phone: data.phone_one,
        address: [data.address, data.city, data.state, data.country, data.zip_code].filter(Boolean).join(', '),
    };
    if (!sender.email || !sender.phone)
        throw new CheckoutError('Vendor contact details are incomplete', 422);

    const physicalShippingItems = rows.filter((item) => !item.is_digital);
    if (physicalShippingItems.some((item) => !Number.isSafeInteger(Number(item.shipbubble_category_id)) || Number(item.shipbubble_category_id) <= 0))
        throw new CheckoutError('A ShipBubble category is missing from a shippable product', 422);
    const packageGroups = groupShippingItems(rows);
    if (!packageGroups.length)
        throw new CheckoutError('No products from this vendor require a shipping quote', 422);

    for (const item of physicalShippingItems) {
        const { weight, dimensions } = itemShippingData(item);
        if (!Number.isFinite(weight) || weight <= 0 ||
            Object.values(dimensions).some((side) => !Number.isFinite(side) || side <= 0))
            throw new CheckoutError(`Shipping weight and dimensions are missing for ${item.name}`, 422);
    }
    const categories = await listShipbubblePackageCategories();
    for (const group of packageGroups) {
        if (!categories.some((category) => Number(category.category_id) === group.category_id))
            throw new CheckoutError(`The ShipBubble category for ${group.items[0].name} is invalid; update the product category`, 422);
    }

    const [senderAddress, receiverAddress] = await Promise.all([
        validatedAddress(sender),
        validatedAddress(receiver),
    ]);
    const lagosNow = lagosDateTime();
    const today = `${lagosNow.year}-${lagosNow.month}-${lagosNow.day}`;
    // Shipbubble schedules requests made after 18:00 GMT+1 for the following day.
    const afterDailyCutoff = Number(lagosNow.hour) >= 18;
    const pickupDate = data.pickup_date || addCalendarDays(today, afterDailyCutoff ? 1 : 0);
    if (afterDailyCutoff && pickupDate === today)
        throw new CheckoutError(
            'ShipBubble processes rate requests after 6 PM the following day; select tomorrow or a later date',
            422
        );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate))
        throw new CheckoutError('Pickup date must use YYYY-MM-DD format', 422);
    const pickupDay = new Date(`${pickupDate}T00:00:00.000Z`);
    if (Number.isNaN(pickupDay.getTime()) || pickupDay.toISOString().slice(0, 10) !== pickupDate)
        throw new CheckoutError('Pickup date must be a valid calendar date', 422);
    const todayUtc = new Date(`${today}T00:00:00.000Z`);
    const daysUntilPickup = Math.floor((pickupDay - todayUtc) / 86400000);
    if (
        Number.isNaN(pickupDay.getTime()) ||
        daysUntilPickup < 0 ||
        daysUntilPickup > 7
    )
        throw new CheckoutError(
            'Pickup date must be today or within the next 7 days',
            422
        );

    const packages = [];
    const quoteRecords = [];
    for (const group of packageGroups) {
        const parcel = calculateParcel(group.items);
        if (!parcel)
            throw new CheckoutError(`The package for ${group.items[0].name} exceeds supported dimensions`, 422);
        const packageItems = group.items.map((item) => {
            const { weight } = itemShippingData(item);
            return {
                name: item.name,
                description: item.description || item.name,
                unit_weight: String(weight),
                unit_amount: String(item.unit_amount),
                quantity: String(item.quantity),
            };
        });
        const fingerprintItems = group.items.map((item) => {
            const { weight, dimensions } = itemShippingData(item);
            return {
                ...item,
                length: dimensions.length,
                width: dimensions.width,
                height: dimensions.height,
                unit_weight: weight,
                unit_amount: item.unit_amount,
                shipbubble_category_id: group.category_id,
            };
        });
        const response = await Shipbubble.requestRates({
            sender_address_code: Number(senderAddress.address_code),
            reciever_address_code: Number(receiverAddress.address_code),
            pickup_date: pickupDate,
            category_id: group.category_id,
            package_items: packageItems,
            package_dimension: parcel.package_dimension,
            service_type: data.service_type,
            delivery_instructions: data.delivery_instructions,
        });
        const requestToken = response?.data?.request_token;
        const couriers = response?.data?.couriers;
        if (!requestToken || !Array.isArray(couriers) || !couriers.length)
            throw new CheckoutError(`ShipBubble returned no shipping options for category ${group.category_id}`, 422);

        const recommendationSources = {
            fastest: response.data.fastest_courier,
            cheapest: response.data.cheapest_courier,
            best_value: response.data.best_value_courier,
        };
        const candidates = couriers.map((courier) => ({ courier, recommended_as: [] }));
        for (const [label, recommendedCourier] of Object.entries(recommendationSources)) {
            if (!recommendedCourier || typeof recommendedCourier !== 'object') continue;
            let candidate = candidates.find(({ courier }) =>
                String(courier.courier_id) === String(recommendedCourier.courier_id) &&
                courier.service_code === recommendedCourier.service_code &&
                (!recommendedCourier.service_type || courier.service_type === recommendedCourier.service_type)
            );
            if (!candidate) {
                candidate = { courier: recommendedCourier, recommended_as: [] };
                candidates.push(candidate);
            }
            candidate.recommended_as.push(label);
        }

        const options = [];
        const recommendations = {};
        for (const { courier, recommended_as: recommendedAs } of candidates) {
            const amount = courier.rate_card_amount ?? courier.total;
            const currency = courier.rate_card_currency ?? courier.currency;
            if (!courier.service_code || courier.courier_id === undefined ||
                amount === undefined || amount === null || currency !== 'NGN') continue;
            minorUnits(amount);
            const id = randomUUID();
            const quoteData = {
                vendor_id: Number(vendorId),
                package_group_key: group.package_group_key,
                category_id: group.category_id,
                package_dimension: parcel.package_dimension,
                total_weight: parcel.total_weight,
                destination_fingerprint: shippingDestinationFingerprint(data),
                cart_fingerprint: shippingCartFingerprint(fingerprintItems),
                request_token: requestToken,
                service_code: String(courier.service_code),
                courier_id: String(courier.courier_id),
                courier_name: String(courier.courier_name || courier.service_code),
                courier_image: courier.courier_image ?? null,
                amount: String(amount),
                provider_total: String(courier.total ?? amount),
                currency,
                service_type: courier.service_type ?? null,
                delivery_eta: courier.delivery_eta ?? null,
                delivery_eta_time: courier.delivery_eta_time ?? null,
                pickup_eta: courier.pickup_eta ?? null,
                pickup_eta_time: courier.pickup_eta_time ?? null,
                dropoff_station: courier.dropoff_station ?? null,
                pickup_station: courier.pickup_station ?? null,
                info: courier.info ?? null,
                tracking: courier.tracking ?? null,
                recommended_as: recommendedAs,
            };
            const option = {
                quote_id: id,
                package_group_key: group.package_group_key,
                vendor_id: Number(vendorId),
                category_id: group.category_id,
                courier_id: quoteData.courier_id,
                service_code: quoteData.service_code,
                courier_name: quoteData.courier_name,
                courier_image: quoteData.courier_image,
                amount: quoteData.amount,
                currency,
                service_type: quoteData.service_type,
                delivery_eta: quoteData.delivery_eta,
                delivery_eta_time: quoteData.delivery_eta_time,
                pickup_eta: quoteData.pickup_eta,
                pickup_eta_time: quoteData.pickup_eta_time,
                dropoff_station: quoteData.dropoff_station,
                pickup_station: quoteData.pickup_station,
                info: quoteData.info,
                tracking: quoteData.tracking,
                recommended_as: quoteData.recommended_as,
            };
            options.push(option);
            quoteRecords.push({ id, requestToken, quoteData, option });
            for (const label of recommendedAs) recommendations[label] = option;
        }
        if (!options.length)
            throw new CheckoutError(`ShipBubble returned no usable NGN rates for category ${group.category_id}`, 422);
        const lowestPricedOption = options.reduce((lowest, option) =>
            minorUnits(option.amount) < minorUnits(lowest.amount) ? option : lowest
        );
        // Pick by the amount charged to the customer, which can differ from
        // ShipBubble's wallet debit for connected couriers.
        const defaultOption = lowestPricedOption;
        for (const option of options) {
            option.selected_by_default = option.quote_id === defaultOption.quote_id;
            const quoteRecord = quoteRecords.find(
                (record) => record.id === option.quote_id
            );
            if (quoteRecord)
                quoteRecord.quoteData.selected_by_default = option.selected_by_default;
        }
        packages.push({
            package_group_key: group.package_group_key,
            category_id: group.category_id,
            package_dimension: parcel.package_dimension,
            total_weight: parcel.total_weight,
            items: group.items.map(({ product_id, variant_id, name, quantity }) => ({
                product_id, variant_id, name, quantity,
            })),
            default_quote_id: defaultOption.quote_id,
            default_selection: 'lowest_price',
            options,
            recommendations,
        });
    }

    for (const record of quoteRecords) {
        const { id, requestToken, quoteData, option } = record;
        await pool.query(
            `INSERT INTO shipbubble_rate_quotes
                (id, user_id, vendor_id, package_group_key, request_token, courier_id,
                 service_code, courier_name, amount, currency, quote_data, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                 NOW() + INTERVAL '${QUOTE_LIFETIME_HOURS} hours')`,
            [id, userId, vendorId, quoteData.package_group_key, requestToken,
                option.courier_id, option.service_code, option.courier_name,
                option.amount, option.currency, JSON.stringify(quoteData)]
        );
    }
    return { vendor_id: Number(vendorId), packages };
}

export async function requestCartShippingRates(userId, data) {
    const { rows: vendors } = await pool.query(
        `SELECT DISTINCT p.vendor_id
         FROM carts c
         JOIN cart_items ci ON ci.cart_id = c.id
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN product_variants pv
           ON pv.id = ci.variant_id AND pv.product_id = p.id
          AND pv.vendor_id = p.vendor_id AND pv.status = 'active'
         WHERE c.user_id = $1
           AND p.status = 'active' AND p.deleted_at IS NULL
           AND p.is_digital = false AND COALESCE(p.free_shipping, false) = false
           AND (ci.variant_id IS NULL OR pv.id IS NOT NULL)
         ORDER BY p.vendor_id`,
        [userId]
    );

    if (!vendors.length)
        throw new CheckoutError(
            'No shippable products were found in your cart',
            404
        );

    const packages = [];
    for (const { vendor_id: vendorId } of vendors) {
        const result = await requestVendorShippingRates(userId, vendorId, data);
        packages.push(
            ...result.packages.map((shippingPackage) => ({
                ...shippingPackage,
                vendor_id: result.vendor_id,
            }))
        );
    }

    return { packages };
}
