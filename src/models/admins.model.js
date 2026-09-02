import pool from '#services/pg_pool.js';
import {
    ADMIN_SCOPES,
    ADMIN_STATUSES,
    PERMISSION_ACTIONS,
    ROLES,
    USER_STATUSES,
    canDelegateGrant,
    canManageAdminTarget,
    isPermissionScopeCompatible,
    isPlatformActor,
    isVendorActor,
} from '#utils/access-control.js';
import AppError, {
    conflictError,
    forbiddenError,
    notFoundError,
} from '#utils/app.error.js';
import ERROR_CODES from '#utils/error.codes.js';

const ADMIN_DETAILS_SELECT = `
    SELECT
        a.id AS admin_id,
        a.user_id,
        a.vendor_id,
        a.scope::text AS scope,
        a.status::text AS admin_status,
        a.authz_version,
        a.invited_at,
        a.invitation_expires_at,
        a.activated_at,
        a.revoked_at,
        a.created_at,
        a.updated_at,
        u.firstname,
        u.lastname,
        u.email,
        u.phone,
        u.country_id,
        u.role::text AS role,
        u.status::text AS user_status,
        u.email_verified
`;

const auditAdminAction = async (
    client,
    {
        actorUserId,
        targetAdminId = null,
        vendorId = null,
        action,
        changes = null,
        audit = {},
    }
) => {
    await client.query(
        `INSERT INTO admin_audit_logs (
            actor_user_id,
            target_admin_id,
            vendor_id,
            action,
            changes,
            request_id,
            ip_address,
            user_agent
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [
            actorUserId,
            targetAdminId,
            vendorId,
            action,
            changes ? JSON.stringify(changes) : null,
            audit.requestId ?? null,
            audit.ipAddress ?? null,
            audit.userAgent ?? null,
        ]
    );
};

const assertVisibleTarget = (actor, target) => {
    if (!actor || !target) throw notFoundError('Admin not found.');

    if (target.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
        throw notFoundError('Admin not found.');
    }

    if (actor.role === ROLES.SUPER_ADMIN) return;

    if (isPlatformActor(actor.role) && target.scope === ADMIN_SCOPES.PLATFORM) {
        return;
    }

    if (
        isVendorActor(actor.role)
        && target.scope === ADMIN_SCOPES.VENDOR
        && Number(actor.vendorId) === Number(target.vendor_id)
    ) {
        return;
    }

    // Out-of-scope records deliberately look absent to prevent tenant discovery.
    throw notFoundError('Admin not found.');
};

const assertManageableTarget = (actor, target) => {
    assertVisibleTarget(actor, target);
    if (!canManageAdminTarget(actor, target)) {
        throw forbiddenError('This administrator cannot be modified.');
    }
};

const fetchAdminDetails = async (client, adminId) => {
    const { rows } = await client.query(
        `${ADMIN_DETAILS_SELECT}
        FROM admins a
        JOIN users u ON u.id = a.user_id
        WHERE a.id = $1
        LIMIT 1`,
        [adminId]
    );
    return rows[0] ?? null;
};

const lockAdmin = async (client, adminId) => {
    const { rows } = await client.query(
        `${ADMIN_DETAILS_SELECT}
        FROM admins a
        JOIN users u ON u.id = a.user_id
        WHERE a.id = $1
        FOR UPDATE OF a, u`,
        [adminId]
    );
    return rows[0] ?? null;
};

const fetchPermissionsWithClient = async (client, adminId) => {
    const admin = await fetchAdminDetails(client, adminId);
    if (!admin) return null;

    const { rows } = await client.query(
        `SELECT
            at.id AS admin_type_id,
            at.slug AS resource,
            at.admin_type AS name,
            at.scope::text AS scope,
            ap.can_create,
            ap.can_read,
            ap.can_update,
            ap.can_delete,
            ap.status,
            ap.expires_at,
            ap.granted_by_user_id,
            ap.updated_at
        FROM admin_permissions ap
        JOIN admin_types at ON at.id = ap.admin_type_id
        WHERE ap.admin_id = $1
        ORDER BY at.slug ASC`,
        [adminId]
    );

    return {
        admin,
        version: admin.authz_version,
        grants: rows,
    };
};

export class AdminModel {
    static async createAdmin({
        actor,
        scope,
        vendorId = null,
        user,
        passwordHash,
        invitationTokenHash,
        invitationExpiresAt,
        audit,
    }) {
        if (scope === ADMIN_SCOPES.PLATFORM && actor.role !== ROLES.SUPER_ADMIN) {
            throw forbiddenError('Only a super administrator can invite platform admins.');
        }

        if (
            scope === ADMIN_SCOPES.VENDOR
            && (
                !isVendorActor(actor.role)
                || Number(actor.vendorId) !== Number(vendorId)
            )
        ) {
            throw forbiddenError('You cannot invite an administrator for this vendor.');
        }

        const role = scope === ADMIN_SCOPES.PLATFORM
            ? ROLES.ADMIN
            : ROLES.VENDOR_ADMIN;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const { rows: userRows } = await client.query(
                `INSERT INTO users (
                    firstname,
                    lastname,
                    email,
                    phone,
                    country_id,
                    password,
                    role,
                    status,
                    email_verified
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
                RETURNING
                    id,
                    firstname,
                    lastname,
                    email,
                    phone,
                    country_id,
                    role::text AS role,
                    status::text AS user_status,
                    email_verified,
                    created_at`,
                [
                    user.firstname,
                    user.lastname,
                    user.email.toLowerCase(),
                    user.phone ?? null,
                    user.country_id ?? null,
                    passwordHash,
                    role,
                    USER_STATUSES.INACTIVE,
                ]
            );
            const createdUser = userRows[0];

            const { rows: adminRows } = await client.query(
                `INSERT INTO admins (
                    user_id,
                    vendor_id,
                    role,
                    scope,
                    status,
                    created_by_user_id,
                    invitation_token_hash,
                    invitation_expires_at,
                    invited_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING
                    id AS admin_id,
                    vendor_id,
                    scope::text AS scope,
                    status::text AS admin_status,
                    authz_version,
                    invited_at,
                    invitation_expires_at,
                    created_at`,
                [
                    createdUser.id,
                    vendorId,
                    role,
                    scope,
                    ADMIN_STATUSES.INVITED,
                    actor.userId,
                    invitationTokenHash,
                    invitationExpiresAt,
                ]
            );
            const createdAdmin = adminRows[0];

            await auditAdminAction(client, {
                actorUserId: actor.userId,
                targetAdminId: createdAdmin.admin_id,
                vendorId,
                action: 'admin.invited',
                changes: {
                    role,
                    scope,
                    email: createdUser.email,
                },
                audit,
            });

            await client.query('COMMIT');
            return { ...createdUser, ...createdAdmin, permissions: [] };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') {
                throw conflictError('An account with that email or invitation already exists.');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    static async acceptInvitation({ invitationTokenHash, passwordHash, audit }) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `${ADMIN_DETAILS_SELECT}
                FROM admins a
                JOIN users u ON u.id = a.user_id
                WHERE a.invitation_token_hash = $1
                  AND a.status = $2
                  AND a.invitation_expires_at > NOW()
                FOR UPDATE OF a, u`,
                [invitationTokenHash, ADMIN_STATUSES.INVITED]
            );
            const target = rows[0];

            if (!target) {
                throw new AppError(
                    'Invitation is invalid or has expired.',
                    400,
                    ERROR_CODES.INVALID_TOKEN
                );
            }

            await client.query(
                `UPDATE users
                SET password = $1,
                    status = $2,
                    email_verified = true,
                    email_verified_at = NOW(),
                    auth_version = auth_version + 1,
                    updated_at = NOW()
                WHERE id = $3`,
                [passwordHash, USER_STATUSES.ACTIVE, target.user_id]
            );

            await client.query(
                `UPDATE admins
                SET status = $1,
                    invitation_token_hash = NULL,
                    invitation_expires_at = NULL,
                    activated_at = NOW(),
                    authz_version = authz_version + 1,
                    updated_at = NOW()
                WHERE id = $2`,
                [ADMIN_STATUSES.ACTIVE, target.admin_id]
            );

            await auditAdminAction(client, {
                actorUserId: target.user_id,
                targetAdminId: target.admin_id,
                vendorId: target.vendor_id,
                action: 'admin.invitation_accepted',
                audit,
            });

            const activated = await fetchAdminDetails(client, target.admin_id);
            await client.query('COMMIT');
            return activated;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async fetchAdmins(actor, { offset = 0, limit = 40, filters = {} } = {}) {
        const values = [];
        const where = [];

        if (actor.role === ROLES.SUPER_ADMIN) {
            if (filters.scope) {
                values.push(filters.scope);
                where.push(`a.scope::text = $${values.length}`);
            }
            if (filters.vendor_id) {
                values.push(filters.vendor_id);
                where.push(`a.vendor_id = $${values.length}`);
            }
        } else if (isPlatformActor(actor.role)) {
            values.push(ADMIN_SCOPES.PLATFORM);
            where.push(`a.scope = $${values.length}`);
            values.push(ROLES.SUPER_ADMIN);
            where.push(`u.role <> $${values.length}`);
        } else if (isVendorActor(actor.role) && actor.vendorId) {
            values.push(ADMIN_SCOPES.VENDOR);
            where.push(`a.scope = $${values.length}`);
            values.push(actor.vendorId);
            where.push(`a.vendor_id = $${values.length}`);
        } else {
            throw forbiddenError();
        }

        if (filters.search?.trim()) {
            values.push(`%${filters.search.trim()}%`);
            where.push(`(
                u.firstname ILIKE $${values.length}
                OR u.lastname ILIKE $${values.length}
                OR u.email ILIKE $${values.length}
                OR u.phone ILIKE $${values.length}
            )`);
        }

        if (filters.status) {
            values.push(filters.status);
            where.push(`a.status::text = $${values.length}`);
        }

        const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
        const safeOffset = Math.max(Number(offset) || 0, 0);
        const whereSql = where.join(' AND ');
        const listValues = [...values, safeLimit, safeOffset];

        const [listResult, countResult] = await Promise.all([
            pool.query(
                `SELECT
                    a.id AS admin_id,
                    a.user_id,
                    a.vendor_id,
                    a.scope::text AS scope,
                    a.status::text AS admin_status,
                    a.authz_version,
                    a.invited_at,
                    a.activated_at,
                    a.created_at,
                    u.firstname,
                    u.lastname,
                    u.email,
                    u.phone,
                    u.country_id,
                    u.role::text AS role,
                    u.status::text AS user_status,
                    COALESCE(
                        JSONB_AGG(
                            JSONB_BUILD_OBJECT(
                                'admin_type_id', at.id,
                                'resource', at.slug,
                                'name', at.admin_type,
                                'scope', at.scope::text,
                                'can_create', ap.can_create,
                                'can_read', ap.can_read,
                                'can_update', ap.can_update,
                                'can_delete', ap.can_delete,
                                'status', ap.status,
                                'expires_at', ap.expires_at
                            )
                            ORDER BY at.slug
                        ) FILTER (WHERE ap.id IS NOT NULL),
                        '[]'::jsonb
                    ) AS permissions
                FROM admins a
                JOIN users u ON u.id = a.user_id
                LEFT JOIN admin_permissions ap ON ap.admin_id = a.id
                LEFT JOIN admin_types at ON at.id = ap.admin_type_id
                WHERE ${whereSql}
                GROUP BY a.id, u.id
                ORDER BY a.created_at DESC
                LIMIT $${values.length + 1}
                OFFSET $${values.length + 2}`,
                listValues
            ),
            pool.query(
                `SELECT COUNT(*)::integer AS total
                FROM admins a
                JOIN users u ON u.id = a.user_id
                WHERE ${whereSql}`,
                values
            ),
        ]);

        return {
            total: countResult.rows[0]?.total ?? 0,
            limit: safeLimit,
            offset: safeOffset,
            rows: listResult.rows,
        };
    }

    static async fetchAdminById(actor, adminId) {
        const admin = await fetchAdminDetails(pool, adminId);
        assertVisibleTarget(actor, admin);
        return fetchPermissionsWithClient(pool, adminId);
    }

    static async updateAdmin(actor, adminId, fields, audit) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const target = await lockAdmin(client, adminId);
            assertManageableTarget(actor, target);

            if (target.admin_status === ADMIN_STATUSES.REVOKED) {
                throw conflictError('A revoked administrator cannot be updated.');
            }
            if (
                target.admin_status === ADMIN_STATUSES.INVITED
                && fields.status
            ) {
                throw conflictError(
                    'Pending administrators must activate their account through the invitation.'
                );
            }

            if (fields.phone) {
                const duplicate = await client.query(
                    `SELECT 1 FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
                    [fields.phone, target.user_id]
                );
                if (duplicate.rowCount > 0) {
                    throw conflictError('Phone number already exists.');
                }
            }

            const userFields = ['firstname', 'lastname', 'phone', 'country_id'];
            const setClauses = [];
            const values = [];
            for (const key of userFields) {
                if (Object.hasOwn(fields, key)) {
                    values.push(fields[key]);
                    setClauses.push(`${key} = $${values.length}`);
                }
            }

            if (setClauses.length > 0) {
                values.push(target.user_id);
                await client.query(
                    `UPDATE users
                    SET ${setClauses.join(', ')}, updated_at = NOW()
                    WHERE id = $${values.length}`,
                    values
                );
            }

            if (fields.status && fields.status !== target.admin_status) {
                const userStatus = fields.status === ADMIN_STATUSES.ACTIVE
                    ? USER_STATUSES.ACTIVE
                    : USER_STATUSES.SUSPENDED;

                await client.query(
                    `UPDATE users
                    SET status = $1, auth_version = auth_version + 1, updated_at = NOW()
                    WHERE id = $2`,
                    [userStatus, target.user_id]
                );
                await client.query(
                    `UPDATE admins
                    SET status = $1,
                        authz_version = authz_version + 1,
                        activated_at = CASE
                            WHEN $1 = 'active' THEN COALESCE(activated_at, NOW())
                            ELSE activated_at
                        END,
                        invitation_token_hash = CASE
                            WHEN $1 = 'suspended' THEN NULL
                            ELSE invitation_token_hash
                        END,
                        invitation_expires_at = CASE
                            WHEN $1 = 'suspended' THEN NULL
                            ELSE invitation_expires_at
                        END,
                        updated_at = NOW()
                    WHERE id = $2`,
                    [fields.status, adminId]
                );
            }

            await auditAdminAction(client, {
                actorUserId: actor.userId,
                targetAdminId: adminId,
                vendorId: target.vendor_id,
                action: 'admin.updated',
                changes: {
                    before: {
                        firstname: target.firstname,
                        lastname: target.lastname,
                        phone: target.phone,
                        country_id: target.country_id,
                        status: target.admin_status,
                    },
                    after: fields,
                },
                audit,
            });

            const updated = await fetchAdminDetails(client, adminId);
            await client.query('COMMIT');
            return updated;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async revokeAdmin(actor, adminId, audit) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const target = await lockAdmin(client, adminId);
            assertManageableTarget(actor, target);

            await client.query(
                `UPDATE users
                SET status = $1, auth_version = auth_version + 1, updated_at = NOW()
                WHERE id = $2`,
                [USER_STATUSES.INACTIVE, target.user_id]
            );
            await client.query(
                `UPDATE admins
                SET status = $1,
                    authz_version = authz_version + 1,
                    invitation_token_hash = NULL,
                    invitation_expires_at = NULL,
                    revoked_at = NOW(),
                    updated_at = NOW()
                WHERE id = $2`,
                [ADMIN_STATUSES.REVOKED, adminId]
            );
            await client.query(
                `UPDATE admin_permissions
                SET status = false, updated_at = NOW()
                WHERE admin_id = $1`,
                [adminId]
            );

            await auditAdminAction(client, {
                actorUserId: actor.userId,
                targetAdminId: adminId,
                vendorId: target.vendor_id,
                action: 'admin.revoked',
                changes: {
                    before: { status: target.admin_status },
                    after: { status: ADMIN_STATUSES.REVOKED },
                },
                audit,
            });

            await client.query('COMMIT');
            return { adminId, userId: target.user_id };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async rotateInvitation(
        actor,
        adminId,
        { invitationTokenHash, invitationExpiresAt },
        audit
    ) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const target = await lockAdmin(client, adminId);
            assertManageableTarget(actor, target);

            if (target.admin_status !== ADMIN_STATUSES.INVITED) {
                throw conflictError('Only pending invitations can be resent.');
            }

            await client.query(
                `UPDATE admins
                SET invitation_token_hash = $1,
                    invitation_expires_at = $2,
                    invited_at = NOW(),
                    authz_version = authz_version + 1,
                    updated_at = NOW()
                WHERE id = $3`,
                [invitationTokenHash, invitationExpiresAt, adminId]
            );

            await auditAdminAction(client, {
                actorUserId: actor.userId,
                targetAdminId: adminId,
                vendorId: target.vendor_id,
                action: 'admin.invitation_resent',
                audit,
            });

            const updated = await fetchAdminDetails(client, adminId);
            await client.query('COMMIT');
            return updated;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async fetchAdminPermissions(actor, adminId) {
        const target = await fetchAdminDetails(pool, adminId);
        assertVisibleTarget(actor, target);
        return fetchPermissionsWithClient(pool, adminId);
    }

    static async replaceAdminPermissions(actor, adminId, version, grants, audit) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const target = await lockAdmin(client, adminId);
            assertManageableTarget(actor, target);

            if (Number(target.authz_version) !== Number(version)) {
                throw conflictError(
                    'Permissions changed since they were loaded. Refresh and try again.'
                );
            }

            if (target.admin_status === ADMIN_STATUSES.REVOKED) {
                throw conflictError('Permissions cannot be assigned to a revoked admin.');
            }

            const requestedIds = grants
                .map((grant) => grant.admin_type_id)
                .filter(Boolean);
            const requestedSlugs = grants
                .map((grant) => grant.resource)
                .filter(Boolean);

            const { rows: types } = grants.length === 0
                ? { rows: [] }
                : await client.query(
                    `SELECT id, slug, scope::text AS scope, status
                    FROM admin_types
                    WHERE id = ANY($1::integer[]) OR slug = ANY($2::text[])`,
                    [requestedIds, requestedSlugs]
                );

            const typesById = new Map(types.map((type) => [Number(type.id), type]));
            const typesBySlug = new Map(types.map((type) => [type.slug, type]));
            const normalizedGrants = grants.map((grant) => {
                const type = grant.admin_type_id
                    ? typesById.get(Number(grant.admin_type_id))
                    : typesBySlug.get(grant.resource);

                if (!type || !type.status) {
                    throw new AppError(
                        'One or more permission resources are invalid or inactive.',
                        422,
                        ERROR_CODES.VALIDATION_ERROR
                    );
                }
                if (!isPermissionScopeCompatible(target.scope, type.scope)) {
                    throw forbiddenError(
                        `Permission resource "${type.slug}" is outside this admin's scope.`
                    );
                }

                return {
                    ...grant,
                    admin_type_id: Number(type.id),
                    resource: type.slug,
                };
            });

            const uniqueTypeIds = new Set(
                normalizedGrants.map((grant) => grant.admin_type_id)
            );
            if (uniqueTypeIds.size !== normalizedGrants.length) {
                throw new AppError(
                    'Each permission resource may appear only once.',
                    422,
                    ERROR_CODES.VALIDATION_ERROR
                );
            }

            if ([ROLES.ADMIN, ROLES.VENDOR_ADMIN].includes(actor.role)) {
                const { rows: actorGrants } = await client.query(
                    `SELECT
                        admin_type_id,
                        can_create,
                        can_read,
                        can_update,
                        can_delete
                    FROM admin_permissions
                    WHERE admin_id = $1
                      AND status = true
                      AND (expires_at IS NULL OR expires_at > NOW())`,
                    [actor.adminId]
                );
                const actorGrantMap = new Map(
                    actorGrants.map((grant) => [Number(grant.admin_type_id), grant])
                );

                for (const grant of normalizedGrants) {
                    if (!canDelegateGrant(actorGrantMap.get(grant.admin_type_id), grant)) {
                        throw forbiddenError(
                            'You cannot grant permissions that you do not hold.'
                        );
                    }
                }
            }

            const before = await fetchPermissionsWithClient(client, adminId);

            for (const grant of normalizedGrants) {
                await client.query(
                    `INSERT INTO admin_permissions (
                        admin_id,
                        admin_type_id,
                        can_create,
                        can_read,
                        can_update,
                        can_delete,
                        status,
                        granted_by_user_id,
                        expires_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
                    ON CONFLICT (admin_id, admin_type_id)
                    DO UPDATE SET
                        can_create = EXCLUDED.can_create,
                        can_read = EXCLUDED.can_read,
                        can_update = EXCLUDED.can_update,
                        can_delete = EXCLUDED.can_delete,
                        status = true,
                        granted_by_user_id = EXCLUDED.granted_by_user_id,
                        expires_at = EXCLUDED.expires_at,
                        updated_at = NOW()`,
                    [
                        adminId,
                        grant.admin_type_id,
                        grant.can_create ?? false,
                        grant.can_read ?? false,
                        grant.can_update ?? false,
                        grant.can_delete ?? false,
                        actor.userId,
                        grant.expires_at ?? null,
                    ]
                );
            }

            const retainedIds = [...uniqueTypeIds];
            if (retainedIds.length === 0) {
                await client.query(
                    'DELETE FROM admin_permissions WHERE admin_id = $1',
                    [adminId]
                );
            } else {
                await client.query(
                    `DELETE FROM admin_permissions
                    WHERE admin_id = $1
                      AND NOT (admin_type_id = ANY($2::integer[]))`,
                    [adminId, retainedIds]
                );
            }

            await client.query(
                `UPDATE admins
                SET authz_version = authz_version + 1, updated_at = NOW()
                WHERE id = $1`,
                [adminId]
            );
            await client.query(
                `UPDATE users
                SET auth_version = auth_version + 1, updated_at = NOW()
                WHERE id = $1`,
                [target.user_id]
            );

            const after = await fetchPermissionsWithClient(client, adminId);
            await auditAdminAction(client, {
                actorUserId: actor.userId,
                targetAdminId: adminId,
                vendorId: target.vendor_id,
                action: 'admin.permissions_replaced',
                changes: {
                    before: before.grants,
                    after: after.grants,
                    previous_version: version,
                    version: after.version,
                },
                audit,
            });

            await client.query('COMMIT');
            return after;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

export default AdminModel;
