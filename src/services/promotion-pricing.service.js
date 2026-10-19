const PLACEMENT_MULTIPLIERS = {
    homepage_banner: 2.5,
    featured_strip: 1.35,
    category_hero: 1.8,
    vendor_banner: 1.2,
    homepage_hero: 2.5,
    category_top_bar: 1.8,
    product_sidebar: 1,
    default: 1,
};

const KEYWORD_MULTIPLIERS = {
    luxury: 1.35,
    premium: 1.25,
    high_demand: 1.3,
    trending: 1.15,
    seasonal: 1.2,
    featured: 1.1,
    default: 1,
};

const SEASON_MULTIPLIERS = {
    peak: 1.2,
    holiday: 1.25,
    festival: 1.2,
    sale: 1.15,
    rainy: 1.1,
    default: 1,
};

export function normalizePlacement(placement) {
    const value = String(placement ?? 'homepage_banner')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');

    if (value === 'homepage_hero') return 'homepage_hero';
    if (value === 'category_top_bar') return 'category_top_bar';
    if (value === 'product_sidebar') return 'product_sidebar';
    if (value in PLACEMENT_MULTIPLIERS) return value;

    return 'default';
}

export function getPlacementMultiplier(placement) {
    return Number(PLACEMENT_MULTIPLIERS[normalizePlacement(placement)] ?? 1);
}

export function getKeywordMultiplier(keyword) {
    const value = String(keyword ?? '').trim().toLowerCase();
    if (!value) return 1;
    return Number(KEYWORD_MULTIPLIERS[value] ?? 1);
}

export function getSeasonMultiplier(season) {
    const value = String(season ?? '').trim().toLowerCase();
    if (!value) return 1;
    return Number(SEASON_MULTIPLIERS[value] ?? 1);
}

export function calculatePromotionPrice({
    placement,
    days,
    baseDailyRate,
    keyword,
    season,
    minTotalPrice = 0,
    platformCommissionRate = 0.2,
} = {}) {
    const normalizedPlacement = normalizePlacement(placement);
    const placementMultiplier = getPlacementMultiplier(normalizedPlacement);
    const durationDays = Math.max(1, Number(days) || 1);
    const baseRate = Number(baseDailyRate) || 0;
    const keywordMultiplier = getKeywordMultiplier(keyword);
    const seasonMultiplier = getSeasonMultiplier(season);

    let durationMultiplier = 1;
    if (durationDays > 30) durationMultiplier = 0.8;
    else if (durationDays > 7) durationMultiplier = 0.9;
    else if (durationDays > 3) durationMultiplier = 0.95;

    const subtotal =
        baseRate *
        durationDays *
        placementMultiplier *
        durationMultiplier *
        keywordMultiplier *
        seasonMultiplier;

    const floorPrice = Number(minTotalPrice) || 0;
    const finalPrice = Math.max(subtotal, floorPrice);
    const platformFee = finalPrice * Number(platformCommissionRate || 0);
    const vendorPayout = finalPrice - platformFee;

    return {
        placement: normalizedPlacement,
        days: durationDays,
        baseDailyRate: baseRate,
        subtotal: Math.round(finalPrice),
        finalPrice: Math.round(finalPrice),
        platformFee: Math.round(platformFee),
        vendorPayout: Math.round(vendorPayout),
        placementMultiplier,
        durationMultiplier,
        keywordMultiplier,
        seasonMultiplier,
    };
}

export default {
    normalizePlacement,
    getPlacementMultiplier,
    getKeywordMultiplier,
    getSeasonMultiplier,
    calculatePromotionPrice,
};
