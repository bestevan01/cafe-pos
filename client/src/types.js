/**
 * 서버 API 응답·도메인 데이터의 공용 타입 정의 (JSDoc 전용, 런타임 코드 없음).
 *
 * 사용법: 상태 선언 위에 JSDoc 타입 태그를 붙이고,
 * 값은 "import(이 파일까지의 상대경로).타입이름" 형태로 참조한다.
 * (예: src/pages/admin/ 아래에서는 상대경로가 ../../types 가 된다)
 *
 * 형태의 출처는 server/migrations/*.sql(테이블)과 server/routes/*.js(계산형 응답)이다.
 * DB에서 온 boolean은 MySQL TINYINT(1)이라 0|1 숫자로 들어온다.
 */

// ---------------------------------------------------------
// 사용자 / 인증
// ---------------------------------------------------------

/**
 * @typedef {'admin'|'staff'|'pending'} Role
 */

/**
 * users 테이블 행 (비밀번호 제외).
 * @typedef {object} User
 * @property {string} id
 * @property {string} username
 * @property {string} name
 * @property {Role} role
 * @property {string} created_at
 */

/**
 * localStorage('user')에 저장되는 로그인 사용자 정보.
 * @typedef {object} AuthUser
 * @property {string} id
 * @property {string} username
 * @property {string} name
 * @property {Role} role
 */

/**
 * GET /api/passkeys 응답 항목.
 * @typedef {object} Passkey
 * @property {string} id
 * @property {string} device_name
 * @property {string} created_at
 */

// ---------------------------------------------------------
// 메뉴 / 주문
// ---------------------------------------------------------

/**
 * menu 테이블 행.
 * @typedef {object} Menu
 * @property {string} id
 * @property {string} name
 * @property {number} price
 * @property {string} type  'coffee' | 'tea' | 'dessert'
 * @property {number} [is_soldout]  0|1
 * @property {number|null} [cost_override]  수동 지정 원가(없으면 레시피로 계산)
 * @property {number} [sort_order]  관리자가 정한 표시 순서(캐셔 화면도 이 차례를 따른다)
 */

/**
 * orders 테이블 행 (GET /api/orders, 매출 목록).
 * @typedef {object} OrderRow
 * @property {string} id
 * @property {number} daily_number
 * @property {string} display_id
 * @property {string} menu_name
 * @property {number} quantity
 * @property {number} total_price
 * @property {string} payment_method  'cash' | 'card' | 'event'
 * @property {number} is_paid  0|1
 * @property {number} is_completed  0|1
 * @property {number} [is_delivered]  0|1
 * @property {string} [staff_name]
 * @property {string|null} [applied_event_id]
 * @property {string} created_at
 */

/**
 * 주문 그룹 내 개별 품목 (클라이언트에서 묶은 형태).
 * @typedef {object} OrderItem
 * @property {string} menu_name
 * @property {number} quantity
 * @property {number} price
 */

/**
 * 주문번호(daily_number) 단위로 묶은 주문 (groupOrdersById 결과).
 * @typedef {object} OrderGroup
 * @property {number} daily_number
 * @property {string} display_id
 * @property {number} is_paid  0|1
 * @property {number} [is_completed]  0|1
 * @property {OrderItem[]} items
 */

/**
 * 캐셔 화면 장바구니 항목.
 * 커피는 잔별 샷 수가 이름·가격에 반영된 항목으로 따로 만들어진다.
 * @typedef {object} CartItem
 * @property {string} name
 * @property {number} price
 * @property {number} quantity
 */

// ---------------------------------------------------------
// 이벤트
// ---------------------------------------------------------

/**
 * events 테이블 행.
 * @typedef {object} CafeEvent
 * @property {string} id
 * @property {string} name
 * @property {'free'|'discount'} type
 * @property {number} discount_amount
 * @property {number|null} daily_limit  하루 한정 수량(없으면 null)
 * @property {string} target_menus  'all' 또는 메뉴명 JSON 배열 문자열
 * @property {number} is_active  0|1
 * @property {number} [used_count]
 * @property {string|null} [last_used_date]
 * @property {string} [created_at]
 */

// ---------------------------------------------------------
// 시재 / 정산
// ---------------------------------------------------------

/**
 * cash_settlements 테이블 행.
 * @typedef {object} Settlement
 * @property {string} id
 * @property {string} date
 * @property {number} opening_amount
 * @property {number} closing_amount
 * @property {number} sales_cash
 * @property {number} difference
 * @property {number} is_closed  0|1
 * @property {string} [created_at]
 */

/**
 * GET /api/settlements/calc — 마감 시 전산상 기대 금액.
 * @typedef {object} SettlementCalc
 * @property {number} opening  오픈 시재
 * @property {number} sales  당일 현금 매출
 * @property {number} expected  기대 마감액(opening + sales)
 */

// ---------------------------------------------------------
// 매출 통계
// ---------------------------------------------------------

/**
 * GET /api/admin/sales/summary 응답.
 * @typedef {object} SalesSummary
 * @property {number} today
 * @property {number} month
 * @property {number} total
 * @property {number} totalCount
 * @property {{year: number, month: number}[]} periods
 */

// ---------------------------------------------------------
// 원가 분석
// ---------------------------------------------------------

/**
 * ingredients 테이블 행.
 * @typedef {object} Ingredient
 * @property {number} id
 * @property {string} name
 * @property {number} purchase_price  구매 가격(원)
 * @property {number|string} purchase_amount  구매 용량/수량 (DECIMAL이라 문자열로 올 수 있음)
 * @property {string} unit  'g' | 'ml' | 'ea'
 * @property {string} category  '식재료' | '부자재'
 * @property {string} [updated_at]
 */

/**
 * menu_recipes 테이블 행 (메뉴 한 잔에 쓰는 원재료 양).
 * @typedef {object} MenuRecipe
 * @property {number} [id]
 * @property {string} menu_id
 * @property {number} ingredient_id
 * @property {number|string} amount
 */

/**
 * GET /api/admin/recipes 응답 항목 — 메뉴 + 그 메뉴의 레시피 구성(레시피 편집기용).
 * @typedef {object} MenuWithRecipe
 * @property {string} menu_id
 * @property {string} name
 * @property {number} price
 * @property {number|null} cost_override
 * @property {{ingredient_id: number, amount: number}[]} items
 */

/**
 * GET /api/admin/cost-analysis 의 rows 항목.
 * @typedef {object} CostRow
 * @property {string} menu_id
 * @property {string} name
 * @property {number} price
 * @property {number} recipe_cost  레시피로 계산한 원가
 * @property {number} effective_cost  실제 적용 원가(수동 지정이 있으면 그 값)
 * @property {boolean} manual  수동 원가 사용 여부
 * @property {boolean} has_recipe
 * @property {number} profit
 * @property {number} margin  0~1
 */

/**
 * GET /api/admin/cost-analysis 의 summary.
 * @typedef {object} CostSummary
 * @property {number} menu_count
 * @property {number} avg_margin
 * @property {CostRow|null} best_profit
 * @property {CostRow|null} worst_margin
 */

export {};
