-- Stop rather than silently delete historical reviews that need manual cleanup.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM reviews WHERE (product_id IS NULL) = (service_id IS NULL)
        OR rating NOT BETWEEN 1 AND 5 OR status NOT IN ('pending','approved','rejected')) THEN
        RAISE EXCEPTION 'Review migration requires valid targets, ratings and statuses. Correct existing reviews before retrying.';
    END IF;
    IF EXISTS (SELECT 1 FROM reviews WHERE product_id IS NOT NULL GROUP BY user_id, product_id HAVING COUNT(*) > 1)
       OR EXISTS (SELECT 1 FROM reviews WHERE service_id IS NOT NULL GROUP BY user_id, service_id HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate customer reviews exist. Reconcile them before applying the review migration.';
    END IF;
END $$;

ALTER TABLE reviews ADD COLUMN booking_id INTEGER,
    ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN moderation_note TEXT;
ALTER TABLE reviews ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id)
    REFERENCES service_bookings(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE reviews ADD CONSTRAINT reviews_one_target CHECK ((product_id IS NOT NULL) <> (service_id IS NOT NULL)),
    ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
    ADD CONSTRAINT reviews_valid_status CHECK (status IN ('pending','approved','rejected')),
    ADD CONSTRAINT reviews_positive_revision CHECK (revision > 0),
    ADD CONSTRAINT reviews_purchase_type CHECK ((product_id IS NULL OR booking_id IS NULL) AND (service_id IS NULL OR order_id IS NULL));
CREATE UNIQUE INDEX reviews_user_id_product_id_key ON reviews(user_id, product_id);
CREATE UNIQUE INDEX reviews_user_id_service_id_key ON reviews(user_id, service_id);
CREATE INDEX reviews_product_id_status_id_idx ON reviews(product_id, status, id);
CREATE INDEX reviews_service_id_status_id_idx ON reviews(service_id, status, id);
CREATE INDEX reviews_status_id_idx ON reviews(status, id);

INSERT INTO admin_types (admin_type, slug, description, scope, is_system, status)
VALUES ('Reviews', 'reviews', 'Read and moderate customer reviews', 'platform', true, true)
ON CONFLICT (slug) DO UPDATE SET scope = 'platform', is_system = true, status = true,
    description = EXCLUDED.description, updated_at = CURRENT_TIMESTAMP;
