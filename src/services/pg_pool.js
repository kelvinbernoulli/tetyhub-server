import { Pool } from 'pg';
import '#config/env.js';

const databaseCa = process.env.DB_SSL_CA
    ?.replace(/\\n/g, '\n')
    .trim();

const pool = new Pool({
    user: process.env.DB_USER_NAME,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: process.env.DB_SSL === 'false'
        ? false
        : {
              rejectUnauthorized: true,
            //   ...(databaseCa ? { ca: databaseCa } : {}),
          }
});

pool.on('error', (err) => {
    console.error('Error connecting to database:', err);
});

export default pool;
