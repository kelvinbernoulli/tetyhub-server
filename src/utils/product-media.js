// Only keys from this application's S3 bucket may be used for cleanup.
export function productObjectKey(
    value,
    bucket = process.env.S3_BUCKET,
    region = process.env.AWS_REGION
) {
    if (typeof value !== 'string' || !value)
        throw new Error('Invalid product image key');
    if (!value.startsWith('https://')) {
        if (
            !value.startsWith('products/') &&
            !value.startsWith('images/products/')
        )
            throw new Error('Invalid product image key');
        return value;
    }
    const url = new URL(value);
    if (
        url.hostname !== `${bucket}.s3.${region}.amazonaws.com` ||
        url.search ||
        url.hash
    )
        throw new Error('Invalid product image URL');
    const key = decodeURIComponent(url.pathname.slice(1));
    if (!key.startsWith('products/') && !key.startsWith('images/products/'))
        throw new Error('Invalid product image key');
    return key;
}
