-- Reconcile the original payout backfill, which read the legacy
-- vendors.commission_rate column instead of the subscription plan.
-- Ledger rows are immutable, so append only the commission difference.
WITH sale_commission AS (
    SELECT le.vendor_id,le.order_id,le.order_item_id,NULL::INTEGER AS booking_id,
        le.amount_minor AS sale_minor,
        COALESCE(event_plan.commission_percent,active_plan.commission_percent,free_plan.commission_percent) AS commission_percent,
        COALESCE(event_plan.plan_name,active_plan.plan_name,free_plan.plan_name) AS commission_plan,
        COALESCE(event_plan.plan_version,active_plan.plan_version,free_plan.plan_version) AS commission_plan_version,
        'order-item:' || le.order_item_id::TEXT AS source_key
    FROM vendor_ledger_entries le
    LEFT JOIN LATERAL (
        SELECT CASE WHEN se.type = 'subscription.free_applied'
                    THEN free_plan.commission_percent ELSE pv.commission_percent END AS commission_percent,
            CASE WHEN se.type = 'subscription.free_applied'
                    THEN free_plan.plan::TEXT ELSE pv.plan::TEXT END AS plan_name,
            CASE WHEN se.type = 'subscription.free_applied'
                    THEN free_plan.version ELSE pv.version END AS plan_version
        FROM subscription_events se
        LEFT JOIN plan_versions pv ON pv.id = se.plan_version_id
        LEFT JOIN LATERAL (
            SELECT commission_percent,plan,version FROM plan_versions
            WHERE plan = 'FREE' AND is_current = TRUE
            ORDER BY version DESC LIMIT 1
        ) free_plan ON TRUE
        WHERE se.provider_id = le.vendor_id
            AND (se.plan_version_id IS NOT NULL OR se.type = 'subscription.free_applied')
            AND se.created_at <= le.created_at
            AND se.type NOT LIKE '%.scheduled'
            AND se.type <> 'checkout.initialized'
        ORDER BY se.created_at DESC,se.id DESC
        LIMIT 1
    ) event_plan ON TRUE
    LEFT JOIN LATERAL (
        SELECT pv.commission_percent,pv.plan::TEXT AS plan_name,pv.version AS plan_version
        FROM subscriptions s
        JOIN plan_versions pv ON pv.plan = s.plan AND pv.version = s.plan_version
        WHERE s.provider_id = le.vendor_id
            AND (
                s.status IN ('active','trialing')
                OR (s.status = 'past_due' AND s.grace_ends_at > NOW())
                OR (s.status = 'cancelled' AND s.cancel_at_period_end = TRUE
                    AND s.current_period_end > NOW())
            )
        ORDER BY s.updated_at DESC,s.id DESC
        LIMIT 1
    ) active_plan ON TRUE
    LEFT JOIN LATERAL (
        SELECT commission_percent,plan::TEXT AS plan_name,version AS plan_version
        FROM plan_versions
        WHERE plan = 'FREE' AND is_current = TRUE
        ORDER BY version DESC
        LIMIT 1
    ) free_plan ON TRUE
    WHERE le.entry_type = 'credit_sale'
        AND le.order_item_id IS NOT NULL
), commission_difference AS (
    SELECT sc.*,
        -ROUND(sc.sale_minor::NUMERIC * sc.commission_percent / 100)::BIGINT
            - COALESCE((
                SELECT SUM(existing.amount_minor)
                FROM vendor_ledger_entries existing
                WHERE existing.order_item_id = sc.order_item_id
                    AND existing.entry_type = 'debit_commission'
            ),0)::BIGINT AS adjustment_minor
    FROM sale_commission sc
    WHERE sc.commission_percent IS NOT NULL
)
INSERT INTO vendor_ledger_entries
    (vendor_id,order_id,order_item_id,entry_type,amount_minor,currency,idempotency_key,metadata)
SELECT cd.vendor_id,cd.order_id,cd.order_item_id,
    CASE WHEN cd.adjustment_minor < 0 THEN 'debit_commission' ELSE 'debit_adjustment' END,
    cd.adjustment_minor,le.currency,
    'commission-plan-correction-v1:' || cd.source_key,
    jsonb_build_object(
        'reason','Corrected legacy vendor commission_rate backfill',
        'commission_rate_percent',cd.commission_percent,
        'commission_plan',cd.commission_plan,
        'commission_plan_version',cd.commission_plan_version
    )
FROM commission_difference cd
JOIN vendor_ledger_entries le ON le.idempotency_key = cd.source_key || ':sale'
WHERE cd.adjustment_minor <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

WITH sale_commission AS (
    SELECT le.vendor_id,le.booking_id,le.amount_minor AS sale_minor,
        COALESCE(event_plan.commission_percent,active_plan.commission_percent,free_plan.commission_percent) AS commission_percent,
        COALESCE(event_plan.plan_name,active_plan.plan_name,free_plan.plan_name) AS commission_plan,
        COALESCE(event_plan.plan_version,active_plan.plan_version,free_plan.plan_version) AS commission_plan_version,
        'booking:' || le.booking_id::TEXT AS source_key
    FROM vendor_ledger_entries le
    LEFT JOIN LATERAL (
        SELECT CASE WHEN se.type = 'subscription.free_applied'
                    THEN free_plan.commission_percent ELSE pv.commission_percent END AS commission_percent,
            CASE WHEN se.type = 'subscription.free_applied'
                    THEN free_plan.plan::TEXT ELSE pv.plan::TEXT END AS plan_name,
            CASE WHEN se.type = 'subscription.free_applied'
                    THEN free_plan.version ELSE pv.version END AS plan_version
        FROM subscription_events se
        LEFT JOIN plan_versions pv ON pv.id = se.plan_version_id
        LEFT JOIN LATERAL (
            SELECT commission_percent,plan,version FROM plan_versions
            WHERE plan = 'FREE' AND is_current = TRUE
            ORDER BY version DESC LIMIT 1
        ) free_plan ON TRUE
        WHERE se.provider_id = le.vendor_id
            AND (se.plan_version_id IS NOT NULL OR se.type = 'subscription.free_applied')
            AND se.created_at <= le.created_at
            AND se.type NOT LIKE '%.scheduled'
            AND se.type <> 'checkout.initialized'
        ORDER BY se.created_at DESC,se.id DESC
        LIMIT 1
    ) event_plan ON TRUE
    LEFT JOIN LATERAL (
        SELECT pv.commission_percent,pv.plan::TEXT AS plan_name,pv.version AS plan_version
        FROM subscriptions s
        JOIN plan_versions pv ON pv.plan = s.plan AND pv.version = s.plan_version
        WHERE s.provider_id = le.vendor_id
            AND (
                s.status IN ('active','trialing')
                OR (s.status = 'past_due' AND s.grace_ends_at > NOW())
                OR (s.status = 'cancelled' AND s.cancel_at_period_end = TRUE
                    AND s.current_period_end > NOW())
            )
        ORDER BY s.updated_at DESC,s.id DESC
        LIMIT 1
    ) active_plan ON TRUE
    LEFT JOIN LATERAL (
        SELECT commission_percent,plan::TEXT AS plan_name,version AS plan_version
        FROM plan_versions
        WHERE plan = 'FREE' AND is_current = TRUE
        ORDER BY version DESC
        LIMIT 1
    ) free_plan ON TRUE
    WHERE le.entry_type = 'credit_sale'
        AND le.booking_id IS NOT NULL
), commission_difference AS (
    SELECT sc.*,
        -ROUND(sc.sale_minor::NUMERIC * sc.commission_percent / 100)::BIGINT
            - COALESCE((
                SELECT SUM(existing.amount_minor)
                FROM vendor_ledger_entries existing
                WHERE existing.booking_id = sc.booking_id
                    AND existing.entry_type = 'debit_commission'
            ),0)::BIGINT AS adjustment_minor
    FROM sale_commission sc
    WHERE sc.commission_percent IS NOT NULL
)
INSERT INTO vendor_ledger_entries
    (vendor_id,booking_id,entry_type,amount_minor,currency,idempotency_key,metadata)
SELECT cd.vendor_id,cd.booking_id,
    CASE WHEN cd.adjustment_minor < 0 THEN 'debit_commission' ELSE 'debit_adjustment' END,
    cd.adjustment_minor,le.currency,
    'commission-plan-correction-v1:' || cd.source_key,
    jsonb_build_object(
        'reason','Corrected legacy vendor commission_rate backfill',
        'commission_rate_percent',cd.commission_percent,
        'commission_plan',cd.commission_plan,
        'commission_plan_version',cd.commission_plan_version
    )
FROM commission_difference cd
JOIN vendor_ledger_entries le ON le.idempotency_key = cd.source_key || ':sale'
WHERE cd.adjustment_minor <> 0
ON CONFLICT (idempotency_key) DO NOTHING;
