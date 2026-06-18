const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const {authenticateToken, requireAdmin} = require('../middlewares/auth');
const debugInfo = require('../utils/debugInfo');

// 이 라우터의 모든 엔드포인트는 관리자 전용
router.use(authenticateToken, requireAdmin);

const ALLOWED_UNITS = ['g', 'ml', 'ea'];

// 단위당 원가(원/단위). 구매 용량이 0 이하이면 0으로 안전 처리.
const unitCostOf = (ing) => {
    const amount = Number(ing.purchase_amount);
    return amount > 0 ? Number(ing.purchase_price) / amount : 0;
};

// ============================================================
// 원재료 (ingredients)
// ============================================================
router.get('/ingredients', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM ingredients ORDER BY name');
        res.json(rows.map(r => ({...r, unit_cost: unitCostOf(r)})));
    } catch (err) {
        console.error('[🔥 GET /api/admin/ingredients 에러]', err);
        res.status(500).json({success: false, message: '원재료 목록을 불러오지 못했습니다.', debug_info: debugInfo(err)});
    }
});

router.post('/ingredients', async (req, res) => {
    const {name, purchase_price, purchase_amount, unit} = req.body;
    if (!name || !ALLOWED_UNITS.includes(unit) || !(Number(purchase_amount) > 0) || !(Number(purchase_price) >= 0)) {
        return res.status(400).json({success: false, message: '입력값이 올바르지 않습니다. (이름·가격·용량·단위 확인)'});
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO ingredients (name, purchase_price, purchase_amount, unit) VALUES (?, ?, ?, ?)',
            [name, purchase_price, purchase_amount, unit]
        );
        res.json({success: true, id: result.insertId});
    } catch (err) {
        console.error('[🔥 POST /api/admin/ingredients 에러]', err);
        res.status(500).json({success: false, message: '원재료 추가에 실패했습니다.', debug_info: debugInfo(err)});
    }
});

router.patch('/ingredients/:id', async (req, res) => {
    const {id} = req.params;
    const {name, purchase_price, purchase_amount, unit} = req.body;
    const fields = [], values = [];

    if (name !== undefined) {
        fields.push('name = ?');
        values.push(name);
    }
    if (purchase_price !== undefined) {
        if (!(Number(purchase_price) >= 0)) return res.status(400).json({
            success: false,
            message: '구매 가격은 0 이상이어야 합니다.'
        });
        fields.push('purchase_price = ?');
        values.push(purchase_price);
    }
    if (purchase_amount !== undefined) {
        if (!(Number(purchase_amount) > 0)) return res.status(400).json({
            success: false,
            message: '구매 용량은 0보다 커야 합니다.'
        });
        fields.push('purchase_amount = ?');
        values.push(purchase_amount);
    }
    if (unit !== undefined) {
        if (!ALLOWED_UNITS.includes(unit)) return res.status(400).json({success: false, message: '단위가 올바르지 않습니다.'});
        fields.push('unit = ?');
        values.push(unit);
    }
    if (fields.length === 0) return res.json({success: true});
    values.push(id);

    try {
        await pool.query(`UPDATE ingredients
                          SET ${fields.join(', ')}
                          WHERE id = ?`, values);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/admin/ingredients/${id} 에러]`, err);
        res.status(500).json({success: false, message: '원재료 수정에 실패했습니다.', debug_info: debugInfo(err)});
    }
});

router.delete('/ingredients/:id', async (req, res) => {
    const {id} = req.params;
    try {
        // 이 원재료를 쓰는 레시피 행은 FK ON DELETE CASCADE로 함께 정리된다.
        await pool.query('DELETE FROM ingredients WHERE id = ?', [id]);
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 DELETE /api/admin/ingredients/${id} 에러]`, err);
        res.status(500).json({success: false, message: '원재료 삭제에 실패했습니다.', debug_info: debugInfo(err)});
    }
});

// ============================================================
// 레시피 (menu_recipes)
// ============================================================
// 메뉴 목록 + 각 메뉴의 레시피 구성(레시피 편집기에서 사용)
router.get('/recipes', async (req, res) => {
    try {
        const [menus] = await pool.query('SELECT id, name, price, cost_override FROM menu ORDER BY id');
        const [recipes] = await pool.query('SELECT menu_id, ingredient_id, amount FROM menu_recipes');

        const byMenu = {};
        for (const r of recipes) {
            (byMenu[r.menu_id] = byMenu[r.menu_id] || []).push({
                ingredient_id: r.ingredient_id,
                amount: Number(r.amount)
            });
        }
        res.json(menus.map(m => ({
            menu_id: m.id,
            name: m.name,
            price: Number(m.price),
            cost_override: m.cost_override === null ? null : Number(m.cost_override),
            items: byMenu[m.id] || []
        })));
    } catch (err) {
        console.error('[🔥 GET /api/admin/recipes 에러]', err);
        res.status(500).json({success: false, message: '레시피를 불러오지 못했습니다.', debug_info: debugInfo(err)});
    }
});

// 특정 메뉴의 레시피를 통째로 교체 (DELETE 후 재삽입)
router.put('/recipes/:menuId', async (req, res) => {
    const {menuId} = req.params;
    const {items} = req.body; // [{ingredient_id, amount}]
    if (!Array.isArray(items)) {
        return res.status(400).json({success: false, message: 'items 배열이 필요합니다.'});
    }
    for (const it of items) {
        if (!Number.isInteger(Number(it.ingredient_id)) || !(Number(it.amount) >= 0)) {
            return res.status(400).json({success: false, message: '레시피 항목이 올바르지 않습니다.'});
        }
    }

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query('DELETE FROM menu_recipes WHERE menu_id = ?', [menuId]);

        // amount > 0 인 항목만 저장 (0은 '사용 안 함'으로 간주)
        const valid = items.filter(it => Number(it.amount) > 0);
        if (valid.length > 0) {
            await conn.query(
                'INSERT INTO menu_recipes (menu_id, ingredient_id, amount) VALUES ?',
                [valid.map(it => [menuId, it.ingredient_id, it.amount])]
            );
        }
        await conn.commit();
        res.json({success: true});
    } catch (err) {
        if (conn) {
            try {
                await conn.rollback();
            } catch (rollbackErr) {
                console.error('[⚠️ 레시피 저장 롤백 실패]', rollbackErr.message);
            }
        }
        console.error(`[🔥 PUT /api/admin/recipes/${menuId} 에러]`, err);
        res.status(500).json({success: false, message: '레시피 저장에 실패했습니다.', debug_info: debugInfo(err)});
    } finally {
        if (conn) conn.release();
    }
});

// ============================================================
// 수동 원가 덮어쓰기 (혼합 모델)
// ============================================================
// cost_override: 숫자면 수동값 사용, null이면 레시피 자동계산으로 복귀
router.patch('/menu/:id/cost-override', async (req, res) => {
    const {id} = req.params;
    const {cost_override} = req.body;
    if (cost_override !== null && !(Number(cost_override) >= 0)) {
        return res.status(400).json({success: false, message: '수동 원가는 0 이상의 숫자여야 합니다.'});
    }
    try {
        await pool.query(
            'UPDATE menu SET cost_override = ? WHERE id = ?',
            [cost_override === null ? null : Number(cost_override), id]
        );
        res.json({success: true});
    } catch (err) {
        console.error(`[🔥 PATCH /api/admin/menu/${id}/cost-override 에러]`, err);
        res.status(500).json({success: false, message: '수동 원가 저장에 실패했습니다.', debug_info: debugInfo(err)});
    }
});

// ============================================================
// 원가·순익 분석 (MVP: 실판매 연동 없이 메뉴 단가 기준)
// ============================================================
// 메뉴별 적용 원가 = cost_override ?? 레시피 자동계산. 순익/마진율까지 서버에서 계산.
router.get('/cost-analysis', async (req, res) => {
    try {
        const [menus] = await pool.query('SELECT id, name, price, cost_override FROM menu ORDER BY id');
        const [ingredients] = await pool.query('SELECT * FROM ingredients');
        const [recipes] = await pool.query('SELECT menu_id, ingredient_id, amount FROM menu_recipes');

        const unitCost = new Map(ingredients.map(i => [i.id, unitCostOf(i)]));
        const recipeByMenu = {};
        for (const r of recipes) {
            (recipeByMenu[r.menu_id] = recipeByMenu[r.menu_id] || []).push(r);
        }

        const rows = menus.map(m => {
            const items = recipeByMenu[m.id] || [];
            const recipeCost = Math.round(
                items.reduce((sum, it) => sum + Number(it.amount) * (unitCost.get(it.ingredient_id) || 0), 0)
            );
            const hasOverride = m.cost_override !== null;
            const effectiveCost = hasOverride ? Number(m.cost_override) : recipeCost;
            const price = Number(m.price);
            const profit = price - effectiveCost;
            return {
                menu_id: m.id,
                name: m.name,
                price,
                recipe_cost: recipeCost,
                effective_cost: effectiveCost,
                manual: hasOverride,       // 수동 원가 사용 여부
                has_recipe: items.length > 0,
                profit,
                margin: price > 0 ? profit / price : 0
            };
        });

        const totalPrice = rows.reduce((s, r) => s + r.price, 0);
        const totalCost = rows.reduce((s, r) => s + r.effective_cost, 0);
        const summary = {
            menu_count: rows.length,
            avg_margin: totalPrice > 0 ? (totalPrice - totalCost) / totalPrice : 0,
            best_profit: rows.slice().sort((a, b) => b.profit - a.profit)[0] || null,
            worst_margin: rows.filter(r => r.has_recipe || r.manual).sort((a, b) => a.margin - b.margin)[0] || null
        };

        res.json({rows, summary});
    } catch (err) {
        console.error('[🔥 GET /api/admin/cost-analysis 에러]', err);
        res.status(500).json({success: false, message: '원가 분석에 실패했습니다.', debug_info: debugInfo(err)});
    }
});

module.exports = router;
