-- Notification recipients used by the isolated checkout and booking fixtures.
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), vendor_id INTEGER, scope TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS admin_types (id SERIAL PRIMARY KEY, slug TEXT, scope TEXT, status BOOLEAN);
CREATE TABLE IF NOT EXISTS admin_permissions (admin_id INTEGER, admin_type_id INTEGER, status BOOLEAN, can_read BOOLEAN, expires_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT, title TEXT, message TEXT, metadata TEXT, read_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW());
