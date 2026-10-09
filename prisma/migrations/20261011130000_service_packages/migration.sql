CREATE TABLE service_packages (
    id SERIAL PRIMARY KEY,
    service_id INTEGER NOT NULL
        REFERENCES services(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL CHECK (price > 0),
    duration_mins INTEGER NOT NULL DEFAULT 60
        CHECK (duration_mins >= 15 AND duration_mins <= 480),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused')),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3),
    deleted_at TIMESTAMP(3)
);

CREATE INDEX service_packages_service_id_deleted_at_idx
    ON service_packages(service_id, deleted_at);
