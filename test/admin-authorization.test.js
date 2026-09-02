import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ADMIN_SCOPES,
    PERMISSION_SCOPES,
    ROLES,
    canDelegateGrant,
    canManageAdminTarget,
    isPermissionScopeCompatible,
} from '../src/utils/access-control.js';
import {
    ADMIN_INVITATION_TTL_MS,
    createAdminInvitation,
    hashAdminInvitationToken,
} from '../src/utils/admin-invitation.js';
import { createAdminSchema } from '../src/schemas/admins.schema.js';
import { replaceAdminPermissionsSchema } from '../src/schemas/permissions.schema.js';

test('roles use the persisted string representation', () => {
    assert.deepEqual(ROLES, {
        CUSTOMER: 'customer',
        VENDOR: 'vendor',
        ADMIN: 'admin',
        VENDOR_ADMIN: 'vendor_admin',
        SUPER_ADMIN: 'super_admin',
    });
});

test('permission resources must match the admin scope', () => {
    assert.equal(
        isPermissionScopeCompatible(ADMIN_SCOPES.PLATFORM, PERMISSION_SCOPES.PLATFORM),
        true
    );
    assert.equal(
        isPermissionScopeCompatible(ADMIN_SCOPES.VENDOR, PERMISSION_SCOPES.BOTH),
        true
    );
    assert.equal(
        isPermissionScopeCompatible(ADMIN_SCOPES.VENDOR, PERMISSION_SCOPES.PLATFORM),
        false
    );
});

test('vendor staff management is tenant isolated', () => {
    const actor = { userId: 10, role: ROLES.VENDOR, vendorId: 50 };
    const sameVendor = {
        user_id: 11,
        role: ROLES.VENDOR_ADMIN,
        scope: ADMIN_SCOPES.VENDOR,
        vendor_id: 50,
    };
    const otherVendor = { ...sameVendor, vendor_id: 51 };

    assert.equal(canManageAdminTarget(actor, sameVendor), true);
    assert.equal(canManageAdminTarget(actor, otherVendor), false);
});

test('self-management and API management of super admins are denied', () => {
    const actor = { userId: 10, role: ROLES.SUPER_ADMIN };
    assert.equal(
        canManageAdminTarget(actor, {
            user_id: 10,
            role: ROLES.ADMIN,
            scope: ADMIN_SCOPES.PLATFORM,
        }),
        false
    );
    assert.equal(
        canManageAdminTarget(actor, {
            user_id: 11,
            role: ROLES.SUPER_ADMIN,
            scope: ADMIN_SCOPES.PLATFORM,
        }),
        false
    );
});

test('super admins can recover vendor-admin accounts across tenants', () => {
    const actor = { userId: 10, role: ROLES.SUPER_ADMIN };
    assert.equal(
        canManageAdminTarget(actor, {
            user_id: 11,
            role: ROLES.VENDOR_ADMIN,
            scope: ADMIN_SCOPES.VENDOR,
            vendor_id: 50,
        }),
        true
    );
});

test('admins cannot delegate an action they do not possess', () => {
    const actorGrant = {
        can_create: false,
        can_read: true,
        can_update: true,
        can_delete: false,
    };

    assert.equal(canDelegateGrant(actorGrant, { can_read: true }), true);
    assert.equal(canDelegateGrant(actorGrant, { can_delete: true }), false);
});

test('admin invitations are random, hashed, and expire after 24 hours', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    const first = createAdminInvitation(now);
    const second = createAdminInvitation(now);

    assert.notEqual(first.token, second.token);
    assert.equal(first.tokenHash, hashAdminInvitationToken(first.token));
    assert.equal(first.tokenHash.length, 64);
    assert.equal(first.expiresAt.getTime() - now.getTime(), ADMIN_INVITATION_TTL_MS);
});

test('admin creation does not accept role or vendor scope from the caller', () => {
    const result = createAdminSchema.validate({
        firstname: 'Ada',
        lastname: 'Lovelace',
        email: 'ada@example.com',
        role: ROLES.SUPER_ADMIN,
        vendor_id: 999,
    });

    assert.ok(result.error);
});

test('permission replacement requires a version and supports explicit revoke-all', () => {
    const revokeAll = replaceAdminPermissionsSchema.validate({
        version: 3,
        grants: [],
    });
    assert.equal(revokeAll.error, undefined);

    const missingVersion = replaceAdminPermissionsSchema.validate({ grants: [] });
    assert.ok(missingVersion.error);
});

test('each permission grant uses exactly one resource identifier', () => {
    const invalid = replaceAdminPermissionsSchema.validate({
        version: 1,
        grants: [{ admin_type_id: 2, resource: 'orders', can_read: true }],
    });
    assert.ok(invalid.error);
});
