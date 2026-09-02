export const ROLES = Object.freeze({
    CUSTOMER: 'customer',
    VENDOR: 'vendor',
    ADMIN: 'admin',
    VENDOR_ADMIN: 'vendor_admin',
    SUPER_ADMIN: 'super_admin',
});

export const USER_STATUSES = Object.freeze({
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
});

export const ADMIN_SCOPES = Object.freeze({
    PLATFORM: 'platform',
    VENDOR: 'vendor',
});

export const ADMIN_STATUSES = Object.freeze({
    INVITED: 'invited',
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    REVOKED: 'revoked',
});

export const PERMISSION_SCOPES = Object.freeze({
    PLATFORM: 'platform',
    VENDOR: 'vendor',
    BOTH: 'both',
});

export const PERMISSION_ACTIONS = Object.freeze({
    CREATE: 'can_create',
    READ: 'can_read',
    UPDATE: 'can_update',
    DELETE: 'can_delete',
});

export const VALID_ROLES = Object.freeze(Object.values(ROLES));

export const isPermissionScopeCompatible = (adminScope, permissionScope) => (
    permissionScope === PERMISSION_SCOPES.BOTH
    || adminScope === permissionScope
);

export const isVendorActor = (role) => (
    role === ROLES.VENDOR || role === ROLES.VENDOR_ADMIN
);

export const isPlatformActor = (role) => (
    role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN
);

export const canManageAdminTarget = (actor, target) => {
    if (!actor || !target || actor.userId === target.user_id) return false;
    if (target.role === ROLES.SUPER_ADMIN) return false;

    if (actor.role === ROLES.SUPER_ADMIN) {
        return true;
    }

    if (actor.role === ROLES.VENDOR) {
        return target.scope === ADMIN_SCOPES.VENDOR
            && Number(actor.vendorId) === Number(target.vendor_id);
    }

    if (actor.role === ROLES.ADMIN) {
        return target.scope === ADMIN_SCOPES.PLATFORM;
    }

    if (actor.role === ROLES.VENDOR_ADMIN) {
        return target.scope === ADMIN_SCOPES.VENDOR
            && Number(actor.vendorId) === Number(target.vendor_id);
    }

    return false;
};

export const canDelegateGrant = (actorGrant, requestedGrant) => {
    if (!actorGrant) return false;

    return Object.values(PERMISSION_ACTIONS).every((action) => (
        requestedGrant[action] !== true || actorGrant[action] === true
    ));
};
