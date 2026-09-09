import { env } from './config.js';
import { Pool } from 'pg';

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
});

pool.on('error', () => {
    console.error('An idle database connection failed.');
});