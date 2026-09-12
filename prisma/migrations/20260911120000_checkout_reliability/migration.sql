BEGIN;
ALTER TABLE orders
  ADD COLUMN currency_id INTEGER,
  ADD COLUMN checkout_key TEXT,
  ADD COLUMN checkout_hash TEXT,
  ADD COLUMN contact_email TEXT,
  ADD COLUMN reservation_expires_at TIMESTAMP(3);
-- Old orders retain null currency and cannot be charged by the new flow until reconciled.
CREATE UNIQUE INDEX orders_user_id_checkout_key_key ON orders(user_id, checkout_key);
CREATE INDEX orders_status_reservation_expires_at_idx ON orders(status, reservation_expires_at);
ALTER TABLE order_items ADD COLUMN stock_reserved BOOLEAN NOT NULL DEFAULT false, ADD COLUMN product_name TEXT;
ALTER TABLE payments ADD COLUMN provider_ref TEXT, ADD COLUMN checkout_data TEXT,
  ADD COLUMN initializing_until TIMESTAMP(3), ADD COLUMN paid_at TIMESTAMP(3);
CREATE UNIQUE INDEX payments_provider_ref_key ON payments(provider_ref);
ALTER TABLE shipping_addresses ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE shipping_addresses ALTER COLUMN country_id DROP NOT NULL;
UPDATE shipping_addresses a SET country = c.name FROM countries c WHERE c.id = a.country_id AND a.country IS NULL;
-- Keep existing addresses readable even when their legacy country reference is missing.
UPDATE shipping_addresses SET country = 'Unknown' WHERE country IS NULL;
ALTER TABLE shipping_addresses ALTER COLUMN country SET NOT NULL;
CREATE TABLE coupon_usage (
  id SERIAL PRIMARY KEY, coupon_id INTEGER NOT NULL, user_id INTEGER NOT NULL, order_id INTEGER NOT NULL
);
CREATE UNIQUE INDEX coupon_usage_order_id_key ON coupon_usage(order_id);
CREATE UNIQUE INDEX coupon_usage_coupon_id_user_id_key ON coupon_usage(coupon_id,user_id);
CREATE TABLE order_status_history (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, status TEXT NOT NULL,
  note TEXT, changed_by INTEGER, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX order_status_history_order_id_created_at_idx ON order_status_history(order_id,created_at);
CREATE TABLE payment_events (
  id SERIAL PRIMARY KEY, payment_id INTEGER NOT NULL, gateway TEXT NOT NULL,
  gateway_event_id TEXT NOT NULL, event_type TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX payment_events_gateway_gateway_event_id_key ON payment_events(gateway,gateway_event_id);
CREATE TABLE checkout_notifications (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, delivered_at TIMESTAMP(3)
);
CREATE UNIQUE INDEX checkout_notifications_order_id_key ON checkout_notifications(order_id);
ALTER TABLE orders ADD CONSTRAINT orders_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE coupon_usage ADD CONSTRAINT coupon_usage_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON UPDATE CASCADE;
ALTER TABLE coupon_usage ADD CONSTRAINT coupon_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE;
ALTER TABLE coupon_usage ADD CONSTRAINT coupon_usage_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE checkout_notifications ADD CONSTRAINT checkout_notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
