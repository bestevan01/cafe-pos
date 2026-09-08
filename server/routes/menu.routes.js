const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

router.get('', authenticateToken, async (req, res) => {
    try {
        // 관리자가 메뉴 관리에서 정한 순서. 캐셔 화면도 이 목록을 그대로 그리므로
        // 여기서 정렬해 두면 직원이 보는 차례까지 한 번에 맞는다.
        // 2차 기준이 name인 이유: id가 UUID라 순서가 무작위다. sort_order가 아직 전부 0인
        // 매장에서도 이름순으로 안정적으로 나와야 한다(마이그레이션 011 참고).
        const [rows] = await pool.query('SELECT * FROM menu ORDER BY sort_order, name');
        res.json(rows);
    } catch (/** @type {any} */ err) {
        console.error('[🔥 GET /api/menu 에러]', err);
        res.status(500).json({
            success: false,
            message: '메뉴 목록을 불러오는 중 오류가 발생했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.post('', authenticateToken, requireAdmin, async (req, res) => {
    const { name, price, type } = req.body;
    if (!name || !Number.isFinite(Number(price)) || Number(price) < 0) {
        return res.status(400).json({ success: false, message: '메뉴 이름과 가격(0 이상)을 올바르게 입력해주세요.' });
    }
    try {
        // 새 메뉴는 항상 맨 뒤로. DEFAULT 0을 그대로 두면 순서를 정해 둔 매장에서
        // 새 메뉴가 매번 맨 위로 튀어 오른다.
        const [[{ next }]] = await pool.query('SELECT IFNULL(MAX(sort_order), 0) + 1 AS next FROM menu');
        await pool.query('INSERT INTO menu (name, price, type, sort_order) VALUES (?, ?, ?, ?)', [
            name,
            price,
            type,
            next,
        ]);
        // 캐셔 화면이 새로고침 없이 바로 받아보도록 알린다(이벤트 변경과 같은 방식).
        req.app.get('io').emit('menu_updated');
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error('[🔥 POST /api/menu 에러]', err);
        res.status(500).json({
            success: false,
            message: '메뉴 추가 중 오류가 발생했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

router.patch('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, price, type, is_soldout } = req.body;
    let fields = [],
        values = [];

    if (name) {
        fields.push('name = ?');
        values.push(name);
    }
    if (price !== undefined) {
        if (!Number.isFinite(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ success: false, message: '가격은 0 이상의 숫자여야 합니다.' });
        }
        fields.push('price = ?');
        values.push(price);
    }
    if (type) {
        fields.push('type = ?');
        values.push(type);
    }
    if (is_soldout !== undefined) {
        fields.push('is_soldout = ?');
        values.push(is_soldout);
    }
    values.push(id);

    try {
        if (fields.length > 0) {
            await pool.query(
                `UPDATE menu
                              SET ${fields.join(', ')}
                              WHERE id = ?`,
                values,
            );
        }
        // 품절 토글도 이 경로를 탄다. 캐셔가 품절을 모르고 주문받는 상황을 막는다.
        req.app.get('io').emit('menu_updated');
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 PATCH /api/menu/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '메뉴 수정 중 오류가 발생했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

// 순서 일괄 저장. [id, id, ...] 순서대로 sort_order를 다시 매긴다.
// '/:id' 라우트보다 앞에 둔다. 지금은 PUT /:id가 없어 충돌하지 않지만,
// 나중에 생기면 'order'가 id 자리로 잡혀 조용히 엉뚱한 핸들러로 간다.
router.put('/order', authenticateToken, requireAdmin, async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    if (!ids || ids.length === 0) return res.status(400).json({ success: false, message: '순서 정보가 없습니다.' });

    const conn = await pool.getConnection();
    try {
        // 한 건이라도 실패하면 순서가 절반만 바뀐 채 남는다. 트랜잭션으로 묶는다.
        await conn.beginTransaction();
        for (let i = 0; i < ids.length; i++) {
            await conn.query('UPDATE menu SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
        }
        await conn.commit();
        req.app.get('io').emit('menu_updated');
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        await conn.rollback();
        console.error('[🔥 PUT /api/menu/order 에러]', err);
        res.status(500).json({
            success: false,
            message: '순서 저장 중 오류가 발생했습니다.',
            debug_info: debugInfo(err),
        });
    } finally {
        conn.release();
    }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM menu WHERE id = ?', [id]);
        req.app.get('io').emit('menu_updated');
        res.json({ success: true });
    } catch (/** @type {any} */ err) {
        console.error(`[🔥 DELETE /api/menu/${id} 에러]`, err);
        res.status(500).json({
            success: false,
            message: '메뉴 삭제 중 오류가 발생했습니다.',
            debug_info: debugInfo(err),
        });
    }
});

module.exports = router;
