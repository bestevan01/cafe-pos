const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).send('pong');
    } catch (/** @type {any} */ error) {
        console.error('[Ping DB Error]', error);
        res.status(500).send('error');
    }
});

module.exports = router;
