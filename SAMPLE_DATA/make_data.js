/* const fs = require('fs');

// 📅 기간: 2025년 9월 1일 ~ 12월 31일
const START_DATE = new Date('2025-09-01');
const END_DATE = new Date('2025-12-31');

// ☕ 메뉴판 (아샷추 부분 오타 수정됨)
const MENUS = [
    {name: '뜨거운 아메리카노', price: 1500},
    {name: '아이스 아메리카노', price: 2000},
    {name: '복숭아 아이스티', price: 2000},
    {name: '아샷추', price: 2500},
    {name: '1L 아이스 아메리카노', price: 3500},
    {name: '1L 복숭아 아이스티', price: 3500},
    {name: '1L 아샷추', price: 4000}
];

const stream = fs.createWriteStream('bulk_data.sql');

console.log("🚀 [순서 정렬 버전] 데이터 생성 시작...");

// 1. 테이블 비우기
stream.write("TRUNCATE TABLE orders;\n\n");

// 2. 날짜별 루프
for (let d = new Date(START_DATE); d <= END_DATE; d.setDate(d.getDate() + 1)) {

    // 금(5), 토(6), 일(0) 제외 (평일만 영업)
    const day = d.getDay();
    if (day === 5 || day === 6 || day === 0) continue;

    const dateStr = d.toISOString().slice(0, 10);
    const dateForId = dateStr.replace(/-/g, '');

    // 하루 주문량 (30~50건)
    const dailyCount = Math.floor(Math.random() * 21) + 30;

    // ⭐️ [변경점 1] 바로 쓰지 않고 임시 배열에 담습니다.
    let dailyOrders = [];

    for (let i = 0; i < dailyCount; i++) {
        // ⏰ 시간 랜덤 생성
        let hour;
        if (Math.random() < 0.5) hour = Math.floor(Math.random() * 2) + 12; // 12~13시 피크
        else hour = Math.floor(Math.random() * 10) + 9; // 09~18시

        const min = Math.floor(Math.random() * 60);
        const sec = Math.floor(Math.random() * 60);

        // 날짜 객체를 생성해서 저장 (정렬을 위해)
        const orderTime = new Date(d);
        orderTime.setHours(hour, min, sec);

        // ☕ 메뉴 및 기타 정보 생성
        const menu = MENUS[Math.floor(Math.random() * MENUS.length)];
        const qty = Math.floor(Math.random() * 10) < 2 ? 2 : 1;
        const totalPrice = menu.price * qty;
        const paymentMethod = Math.random() < 0.2 ? 'cash' : 'bank';

        // 배열에 푸시
        dailyOrders.push({
            orderTime, // 정렬용 Date 객체
            menu,
            qty,
            totalPrice,
            paymentMethod
        });
    }

    // ⭐️ [변경점 2] 시간순으로 오름차순 정렬 (아침 -> 저녁)
    dailyOrders.sort((a, b) => a.orderTime - b.orderTime);

    // ⭐️ [변경점 3] 정렬된 순서대로 번호를 매기고 파일에 작성
    dailyOrders.forEach((order, index) => {
        const dailyNum = index + 1; // 1번부터 순차 증가
        const displayId = `${dateForId}-${String(dailyNum).padStart(3, '0')}`;

        // Date 객체를 다시 SQL 포맷 문자열로 변환
        const fullDate = toSqlDatetime(order.orderTime);

        const sql = `INSERT INTO orders 
        (daily_number, display_id, menu_name, quantity, total_price, payment_method, is_paid, is_completed, is_delivered, created_at) 
        VALUES 
        (${dailyNum}, '${displayId}', '${order.menu.name}', ${order.qty}, ${order.totalPrice}, '${order.paymentMethod}', 1, 1, 1, '${fullDate}');\n`;

        stream.write(sql);
    });
}

stream.end(() => {
    console.log("✅ 'bulk_data.sql' 파일 생성 완료!");
    console.log("👉 이제 daily_number 순서와 시간 순서가 정확히 일치합니다.");
});

// 날짜 포맷팅 헬퍼 함수 (YYYY-MM-DD HH:mm:ss)
function toSqlDatetime(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}*/

const fs = require('fs');

const START_DATE = new Date('2025-09-01');
const END_DATE = new Date('2025-12-31');

const MENUS = [
    {name: '뜨거운 아메리카노', price: 1500},
    {name: '아이스 아메리카노', price: 2000},
    {name: '복숭아 아이스티', price: 2000},
    {name: '아샷추', price: 2500},
    {name: '1L 아이스 아메리카노', price: 3500},
    {name: '1L 복숭아 아이스티', price: 3500},
    {name: '1L 아샷추', price: 4000}
];

const stream = fs.createWriteStream('bulk_data.sql');

console.log("🚀 [최적화 버전] 데이터 생성 시작...");

// 1. 초기화
stream.write("TRUNCATE TABLE orders;\n\n");

// 모든 데이터를 담을 거대한 배열 (메모리 문제 없으니 안심하세요)
let allOrders = [];

// 2. 데이터 생성 (날짜별 루프)
for (let d = new Date(START_DATE); d <= END_DATE; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day === 5 || day === 6 || day === 0) continue; // 평일만

    const dateStr = d.toISOString().slice(0, 10);
    const dateForId = dateStr.replace(/-/g, '');
    const dailyCount = Math.floor(Math.random() * 21) + 30; // 30~50건

    let dailyOrders = [];

    for (let i = 0; i < dailyCount; i++) {
        let hour;
        if (Math.random() < 0.5) hour = Math.floor(Math.random() * 2) + 12;
        else hour = Math.floor(Math.random() * 10) + 9;

        const min = Math.floor(Math.random() * 60);
        const sec = Math.floor(Math.random() * 60);
        const orderTime = new Date(d);
        orderTime.setHours(hour, min, sec);

        const menu = MENUS[Math.floor(Math.random() * MENUS.length)];
        const qty = Math.floor(Math.random() * 10) < 2 ? 2 : 1;
        const totalPrice = menu.price * qty;
        const paymentMethod = Math.random() < 0.2 ? 'cash' : 'bank';

        dailyOrders.push({
            orderTime,
            menu,
            qty,
            totalPrice,
            paymentMethod,
            dateForId // ID 생성을 위해 전달
        });
    }

    // 하루치 시간 정렬
    dailyOrders.sort((a, b) => a.orderTime - b.orderTime);

    // 정렬된 하루치 데이터에 번호 매겨서 전체 리스트에 추가
    dailyOrders.forEach((order, index) => {
        const dailyNum = index + 1;
        const displayId = `${order.dateForId}-${String(dailyNum).padStart(3, '0')}`;

        // SQL 값 부분만 미리 문자열로 만들어둠
        const valueString = `(${dailyNum}, '${displayId}', '${order.menu.name}', ${order.qty}, ${order.totalPrice}, '${order.paymentMethod}', 1, 1, 1, '${toSqlDatetime(order.orderTime)}')`;

        allOrders.push(valueString);
    });
}

// 3. 100개씩 묶어서 INSERT 문 작성 (Bulk Insert)
const BATCH_SIZE = 100;
const totalCount = allOrders.length;

for (let i = 0; i < totalCount; i += BATCH_SIZE) {
    // 100개 자르기
    const chunk = allOrders.slice(i, i + BATCH_SIZE);

    // 묶어서 하나의 쿼리로 만듦
    const sql = `INSERT INTO orders (daily_number, display_id, menu_name, quantity, total_price, payment_method, is_paid, is_completed, is_delivered, created_at) VALUES 
${chunk.join(',\n')};\n`;

    stream.write(sql);
}

stream.end(() => {
    console.log(`✅ 총 ${totalCount}건의 데이터 생성 완료!`);
    console.log("👉 100건씩 묶여있어 TiDB에 훨씬 빨리 들어갑니다.");
});

function toSqlDatetime(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}