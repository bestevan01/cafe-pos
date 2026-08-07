const mysql = require('mysql2/promise');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** @type {any} */
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: IS_PRODUCTION },
    timezone: '+09:00',
});

pool.on('connection', (/** @type {any} */ connection) => {
    connection.query("SET time_zone = '+09:00';");
});

module.exports = pool;
