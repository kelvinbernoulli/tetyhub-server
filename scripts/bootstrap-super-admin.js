import pool from '../src/services/pg_pool.js';
import { ROLES, ADMIN_SCOPES, ADMIN_STATUSES, USER_STATUSES } from '../src/utils/access-control.js';
import { passwordHash, validatePassword } from '../src/utils/helpers.js';

const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD;
const firstname = process.env.SUPER_ADMIN_FIRSTNAME?.trim() || 'Super';
const lastname = process.env.SUPER_ADMIN_LASTNAME?.trim() || 'Admin';

const fail = (message) => {
    throw new Error(message);
};

const bootstrap = async () => {
    if (!email || !password) {
        fail('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required.');
    }
    if (password.length < 16 || !validatePassword(password)) {
        fail('SUPER_ADMIN_PASSWORD must be at least 16 characters and meet complexity rules.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('tetyhub:bootstrap-super-admin'))");

        const existing = await client.query(
            `SELECT u.id
            FROM users u
            JOIN admins a ON a.user_id = u.id
            WHERE u.role = $1 AND a.scope = $2 AND a.status = $3
            LIMIT 1`,
            [ROLES.SUPER_ADMIN, ADMIN_SCOPES.PLATFORM, ADMIN_STATUSES.ACTIVE]
        );
        if (existing.rowCount > 0) {
            fail('An active super administrator already exists.');
        }

        const hashedPassword = await passwordHash(password);
        const { rows: users } = await client.query(
            `INSERT INTO users (
                firstname, lastname, email, password, role, status,
                email_verified, email_verified_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
            RETURNING id`,
            [
                firstname,
                lastname,
                email,
                hashedPassword,
                ROLES.SUPER_ADMIN,
                USER_STATUSES.ACTIVE,
            ]
        );
        const userId = users[0].id;

        const { rows: admins } = await client.query(
            `INSERT INTO admins (
                user_id, role, scope, status, activated_at, invited_at
            )
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id`,
            [userId, ROLES.SUPER_ADMIN, ADMIN_SCOPES.PLATFORM, ADMIN_STATUSES.ACTIVE]
        );
        const adminId = admins[0].id;

        await client.query(
            `INSERT INTO admin_audit_logs (
                actor_user_id, target_admin_id, action, changes
            )
            VALUES ($1, $2, 'super_admin.bootstrapped', $3::jsonb)`,
            [userId, adminId, JSON.stringify({ email })]
        );

        await client.query('COMMIT');
        console.log(`Super administrator bootstrapped for ${email}.`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

try {
    await bootstrap();
} catch (error) {
    console.error(`Super-admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
