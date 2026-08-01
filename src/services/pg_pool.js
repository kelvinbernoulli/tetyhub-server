import { Pool } from 'pg';
import { config } from 'dotenv';
config();

const pool = new Pool({
    user: process.env.DB_USER_NAME,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false,
    }
});

pool.on('error', (err) => {
    console.error('Error connecting to database:', err);
});

export default pool;
