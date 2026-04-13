import {useState, useEffect, useMemo} from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import AdvancedStats from "./AdvancedStats.jsx";
import ThemeToggle from '../../components/ThemeToggle';

function SalesDashboard({onBack}) {
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [salesData, setSalesData] = useState([]);
    const [loading, setLoading] = useState(true);

    // 필터링 상태
    const [selectedYear, setSelectedYear] = useState('all');
    const [selectedMonth, setSelectedMonth] = useState('all');
    const [selectedDay, setSelectedDay] = useState('all');
    const [selectedHour, setSelectedHour] = useState('all');
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');

    // UI 상태 (정렬, 고급 통계 모드)
    const [sortConfig, setSortConfig] = useState({key: null, direction: 'default'});
    const [showAdvanced, setShowAdvanced] = useState(false);

    // API 권한 토큰
    const getAuthHeader = () => ({
        headers: {Authorization: `Bearer ${localStorage.getItem('token')}`}
    });

    // ---------------------------------------------------------
    // [2] 데이터 조회 및 API
    // ---------------------------------------------------------
    useEffect(() => {
        void fetchSales();
    }, []);

    const fetchSales = async () => {
        try {
            setLoading(true);
            const res = await axios.get('/api/admin/sales', getAuthHeader());

            setSalesData(res.data);
            setLoading(false);
        } catch (err) {
            if (err.response && err.response.status === 401) {
                alert("로그인 세션이 만료되었습니다.");
            } else {
                alert("데이터 로딩 실패");
            }
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('정말 삭제(환불) 처리하시겠습니까?')) return;
        try {
            await axios.delete(`/api/admin/sales/${id}`, getAuthHeader());

            await fetchSales();
        } catch (err) {
            alert('삭제 실패: 권한이 없거나 오류가 발생했습니다.');
        }
    };

    // ---------------------------------------------------------
    // [3] 필터링 및 정렬 로직 (useMemo)
    // ---------------------------------------------------------
    const filteredData = useMemo(() => {
        let target = salesData;
        if (selectedYear !== 'all') target = target.filter(item => new Date(item.created_at).getFullYear() === parseInt(selectedYear));
        if (selectedMonth !== 'all') target = target.filter(item => (new Date(item.created_at).getMonth() + 1) === parseInt(selectedMonth));
        if (selectedDay !== 'all') target = target.filter(item => new Date(item.created_at).getDate() === parseInt(selectedDay));
        if (selectedHour !== 'all') target = target.filter(item => new Date(item.created_at).getHours() === parseInt(selectedHour));
        if (selectedPaymentMethod !== 'all') target = target.filter(item => item.payment_method === selectedPaymentMethod);
        return target;
    }, [salesData, selectedYear, selectedMonth, selectedDay, selectedHour, selectedPaymentMethod]);

    const sortedData = useMemo(() => {
        let sortableItems = [...filteredData];
        if (sortConfig.key !== null && sortConfig.direction !== 'default') {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key] ?? '';
                let bValue = b[sortConfig.key] ?? '';

                if (sortConfig.key === 'created_at') {
                    aValue = new Date(aValue);
                    bValue = new Date(bValue);
                } else if (typeof aValue === 'string') {
                    return sortConfig.direction === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [filteredData, sortConfig]);

    // ---------------------------------------------------------
    // [4] 통계 계산 로직
    // ---------------------------------------------------------
    const stats = useMemo(() => {
        const getKSTDateStr = (isoString) => new Date(isoString).toLocaleString('en-CA', {
            hour12: false,
            timeZone: 'Asia/Seoul'
        }).slice(0, 10);
        const todayKST = getKSTDateStr(new Date().toISOString());
        const monthKST = todayKST.slice(0, 7);

        const todaySum = salesData.filter(item => getKSTDateStr(item.created_at) === todayKST).reduce((acc, cur) => acc + cur.total_price, 0);
        const monthSum = salesData.filter(item => getKSTDateStr(item.created_at).startsWith(monthKST)).reduce((acc, cur) => acc + cur.total_price, 0);
        const filteredTotal = filteredData.reduce((acc, cur) => acc + cur.total_price, 0);

        return {today: todaySum, month: monthSum, count: filteredData.length, filteredTotal: filteredTotal};
    }, [salesData, filteredData]);

    // ---------------------------------------------------------
    // [5] 헬퍼 함수 (정렬, 엑셀, 옵션 생성)
    // ---------------------------------------------------------
    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') direction = 'desc';
            else if (sortConfig.direction === 'desc') direction = 'default';
        }
        setSortConfig({key, direction});
    };

    const getSortIndicator = (name) => {
        if (sortConfig.key !== name || sortConfig.direction === 'default') return ' -';
        return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
    };

    const exportExcel = () => {
        const excelData = sortedData.map(item => ({
            '날짜': new Date(item.created_at).toLocaleString('ko-KR'),
            '주문번호': item.display_id,
            '일일번호': item.daily_number,
            '메뉴명': item.menu_name,
            '수량': item.quantity,
            '결제금액': item.total_price,
            '결제수단': item.payment_method === 'bank' ? '계좌이체' : (item.payment_method === 'event' ? '이벤트' : '현금'),
            '담당자': item.staff_name
        }));
        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "매출내역");
        XLSX.writeFile(wb, `매출내역_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const resetFilters = () => {
        setSelectedYear('all');
        setSelectedMonth('all');
        setSelectedDay('all');
        setSelectedHour('all');
        setSelectedPaymentMethod('all');
        setSortConfig({key: null, direction: 'default'});
    };

    // 드롭다운 옵션 동적 생성
    const getAvailableYears = () => Array.from(new Set(salesData.map(item => new Date(item.created_at).getFullYear()))).sort((a, b) => b - a);
    const getAvailableMonths = () => selectedYear === 'all' ? [] : Array.from(new Set(salesData.filter(item => new Date(item.created_at).getFullYear() === parseInt(selectedYear)).map(item => new Date(item.created_at).getMonth() + 1))).sort((a, b) => a - b);
    const getAvailableDays = () => (selectedYear === 'all' || selectedMonth === 'all') ? [] : Array.from(new Set(salesData.filter(item => new Date(item.created_at).getFullYear() === parseInt(selectedYear) && (new Date(item.created_at).getMonth() + 1) === parseInt(selectedMonth)).map(item => new Date(item.created_at).getDate()))).sort((a, b) => a - b);
    const getAvailableHours = () => (selectedYear === 'all' || selectedMonth === 'all' || selectedDay === 'all') ? [] : Array.from(new Set(salesData.filter(item => new Date(item.created_at).getFullYear() === parseInt(selectedYear) && (new Date(item.created_at).getMonth() + 1) === parseInt(selectedMonth) && new Date(item.created_at).getDate() === parseInt(selectedDay)).map(item => new Date(item.created_at).getHours()))).sort((a, b) => a - b);

    const periodLabel = useMemo(() => {
        if (selectedYear === 'all') return `전체 기간 ${selectedPaymentMethod !== 'all' ? `(${selectedPaymentMethod === 'bank' ? '계좌' : '현금'})` : ''}`;
        let label = `${selectedYear}년`;
        if (selectedMonth !== 'all') label += ` ${selectedMonth}월`;
        if (selectedDay !== 'all') label += ` ${selectedDay}일`;
        if (selectedHour !== 'all') label += ` ${selectedHour}시`;
        if (selectedPaymentMethod !== 'all') label += ` (${selectedPaymentMethod === 'bank' ? '계좌' : '현금'})`;
        return label;
    }, [selectedYear, selectedMonth, selectedDay, selectedHour, selectedPaymentMethod]);

    // ---------------------------------------------------------
    // [6] 렌더링 (Render)
    // ---------------------------------------------------------
    if (loading) return <div style={{padding: '50px', textAlign: 'center', color: 'var(--text-secondary)'}}>데이터를 불러오는
        중입니다...</div>;
    if (showAdvanced) return <AdvancedStats onBack={() => setShowAdvanced(false)}/>;

    return (
        <div className="sales-container">
            <style>
                {`
                .sales-container { padding: 20px; background-color: var(--bg-color, #f4f6f8); height: 100vh; display: flex; flex-direction: column; box-sizing: border-box; transition: background-color 0.3s ease; overflow: hidden; }
                .sales-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-shrink: 0; gap: 10px; }
                .header-left, .header-right { display: flex; align-items: center; gap: 10px; }
                .sales-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                
                .btn-back, .btn-advanced, .btn-excel, .btn-refresh { padding: 10px 15px; border: none; border-radius: var(--radius-md); cursor: pointer; font-weight: bold; color: white; display: flex; align-items: center; gap: 5px; white-space: nowrap; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
                .btn-back:active, .btn-advanced:active, .btn-excel:active, .btn-refresh:active { opacity: 0.8; }
                .btn-back { background-color: #6c757d; }
                .btn-advanced { background-color: #673ab7; }
                .btn-excel { background-color: #217346; }
                .btn-refresh { background-color: #0284c7; }
                
                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 25px; flex-shrink: 0; }
                .stat-card { background-color: var(--card-bg, white); padding: 25px 20px; border-radius: var(--radius-lg); box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; transition: background-color 0.3s; }
                .stat-title { margin: 0 0 10px 0; font-size: 1rem; color: var(--text-secondary, #666); font-weight: bold; }
                .stat-val { margin: 0; font-size: 1.8rem; font-weight: 800; color: var(--text-primary, #333); }
                .stat-val.green { color: #2e7d32; } .stat-val.blue { color: #1565c0; }

                .table-card { background-color: var(--card-bg, white); padding: 25px; border-radius: var(--radius-lg); box-shadow: 0 4px 15px rgba(0,0,0,0.05); flex: 1; display: flex; flex-direction: column; min-height: 0; }
                .filter-area { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; flex-shrink: 0; }
                .filter-group { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
                .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
                .filter-select { height: 36px; padding: 0 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, white); color: var(--text-primary, #333); }
                .btn-filter { height: 36px; padding: 0 15px; border-radius: var(--radius-sm); border: none; color: white; cursor: pointer; font-weight: bold; }

                .table-responsive { flex: 1; overflow: auto; }
                .sales-table { width: 100%; border-collapse: collapse; text-align: center; }
                .sales-table th { padding: 15px; border-bottom: 2px solid var(--border-color, #ddd); position: sticky; top: 0; background-color: var(--card-bg, white); z-index: 10; cursor: pointer; color: var(--text-secondary, #666); }
                .sales-table td { padding: 12px; border-bottom: 1px solid var(--border-color, #eee); color: var(--text-primary, #333); }
                
                .pay-badge { padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: bold; }
                .pay-cash { background-color: rgba(46, 125, 50, 0.1); color: #2e7d32; }
                .pay-bank { background-color: rgba(237, 108, 2, 0.1); color: #ed6c02; }
                .pay-event { background-color: rgba(0, 123, 255, 0.1); color: #007bff; }
                .btn-del { padding: 6px 12px; background-color: #ffebee; color: #dc3545; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; }
                
                .sales-card-view { display: none; }
                
                /* 다크모드 오버라이드 */
                [data-theme='dark'] .stat-val.green { color: #4caf50; }
                [data-theme='dark'] .stat-val.blue { color: #4facfe; }
                [data-theme='dark'] .pay-cash { background-color: rgba(76, 175, 80, 0.15); color: #81c784; }
                [data-theme='dark'] .pay-bank { background-color: rgba(255, 152, 0, 0.15); color: #ffb74d; }
                [data-theme='dark'] .pay-event { background-color: rgba(0, 123, 255, 0.15); color: #66b2ff; }
                [data-theme='dark'] .btn-del { background-color: rgba(220, 53, 69, 0.2); color: #ff8a80; }

                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .sales-container { height: auto; min-height: 100vh; padding: 15px; overflow: visible; }
                    .sales-header { flex-direction: column; align-items: flex-start; gap: 12px; position: relative; }
                    .header-left { width: 100%; } .header-right { width: 100%; margin-top: 5px; }
                    .theme-wrapper { position: absolute; top: 0; right: 0; }
                    .btn-advanced, .btn-excel { flex: 1; justify-content: center; }
                    .stats-grid { grid-template-columns: 1fr; }
                    .table-card { padding: 0; background: none; border: none; box-shadow: none; display: block; }
                    .table-responsive { display: none; }
                    .sales-card-view { display: flex; flex-direction: column; gap: 12px; }
                    .filter-area { flex-direction: column; align-items: stretch; }
                    .filter-row { display: grid; width: 100%; }
                    .filter-row.top-row { grid-template-columns: 1fr 2fr; }
                    .filter-row.bottom-row { grid-template-columns: repeat(4, 1fr); }
                    .filter-select { padding: 0 4px; text-align: center; font-size: 0.85rem; }
                    
                    .mobile-card { background-color: var(--card-bg, white); border-radius: var(--radius-lg); padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border-color, #eee); }
                    .mc-header, .mc-body, .mc-footer { display: flex; justify-content: space-between; align-items: center; }
                    .mc-header { border-bottom: 1px dashed var(--border-color, #ddd); padding-bottom: 8px; font-size: 0.85rem; color: var(--text-secondary, #666); }
                    .mc-menu { font-weight: bold; font-size: 1.1rem; color: var(--text-primary, #333); }
                    .mc-price { font-weight: bold; color: #d32f2f; font-size: 1.1rem; }
                }
                `}
            </style>

            {/* 헤더 영역 */}
            <div className="sales-header">
                <div className="header-left">
                    <button onClick={onBack} className="btn-back">⬅ 뒤로</button>
                    <h2 className="sales-title">💰 매출 통계</h2>
                </div>
                <div className="header-right">
                    <div className="theme-wrapper"><ThemeToggle/></div>
                    <button onClick={fetchSales} className="btn-refresh">🔄 새로고침</button>
                    <button onClick={() => setShowAdvanced(true)} className="btn-advanced">📊 고급 통계</button>
                    <button onClick={exportExcel} className="btn-excel">📗 엑셀 다운로드</button>
                </div>
            </div>

            {/* 요약 통계 카드 */}
            <div className="stats-grid">
                {selectedYear === 'all' && selectedPaymentMethod === 'all' ? (
                    <>
                        <div className="stat-card">
                            <h3 className="stat-title">📅 오늘 매출</h3>
                            <p className="stat-val">{stats.today.toLocaleString()}원</p>
                        </div>
                        <div className="stat-card">
                            <h3 className="stat-title">🗓 이번 달 매출</h3>
                            <p className="stat-val green">{stats.month.toLocaleString()}원</p>
                        </div>
                        <div className="stat-card">
                            <h3 className="stat-title">🧾 전체 주문 수</h3>
                            <p className="stat-val blue">{stats.count}건</p>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="stat-card">
                            <h3 className="stat-title">🔍 조회 기간</h3>
                            <p className="stat-val" style={{fontSize: '1.2rem'}}>{periodLabel}</p>
                        </div>
                        <div className="stat-card">
                            <h3 className="stat-title">💰 기간 총 매출</h3>
                            <p className="stat-val green">{stats.filteredTotal.toLocaleString()}원</p>
                        </div>
                        <div className="stat-card">
                            <h3 className="stat-title">🧾 조회된 주문 수</h3>
                            <p className="stat-val blue">{stats.count}건</p>
                        </div>
                    </>
                )}
            </div>

            {/* 상세 내역 테이블 및 필터 */}
            <div className="table-card">
                <div className="filter-area">
                    <h3 className="filter-title" style={{margin: 0}}>상세 내역</h3>
                    <div className="filter-group">
                        <div className="filter-row top-row">
                            <button onClick={resetFilters} className="btn-filter"
                                    style={{backgroundColor: selectedYear === 'all' && selectedPaymentMethod === 'all' ? '#007bff' : '#6c757d'}}>초기화
                            </button>
                            <select value={selectedPaymentMethod}
                                    onChange={(e) => setSelectedPaymentMethod(e.target.value)} className="filter-select"
                                    style={{borderColor: selectedPaymentMethod !== 'all' ? '#007bff' : 'var(--border-color, #ccc)'}}>
                                <option value="all">결제수단: 전체</option>
                                <option value="cash">현금</option>
                                <option value="bank">계좌이체</option>
                            </select>
                        </div>
                        <div className="filter-row bottom-row">
                            <select value={selectedYear} onChange={(e) => {
                                setSelectedYear(e.target.value);
                                setSelectedMonth('all');
                                setSelectedDay('all');
                                setSelectedHour('all');
                            }} className="filter-select">
                                <option value="all">연도 선택</option>
                                {getAvailableYears().map(year => (<option key={year} value={year}>{year}년</option>))}
                            </select>
                            <select value={selectedMonth} onChange={(e) => {
                                setSelectedMonth(e.target.value);
                                setSelectedDay('all');
                                setSelectedHour('all');
                            }} className="filter-select" disabled={selectedYear === 'all'}>
                                <option value="all">월 선택</option>
                                {getAvailableMonths().map(month => (
                                    <option key={String(month)} value={String(month)}>{month}월</option>))}
                            </select>
                            <select value={selectedDay} onChange={(e) => {
                                setSelectedDay(e.target.value);
                                setSelectedHour('all');
                            }} className="filter-select" disabled={selectedMonth === 'all'}>
                                <option value="all">일 선택</option>
                                {getAvailableDays().map(day => (
                                    <option key={String(day)} value={String(day)}>{day}일</option>))}
                            </select>
                            <select value={selectedHour} onChange={(e) => setSelectedHour(e.target.value)}
                                    className="filter-select" disabled={selectedDay === 'all'}>
                                <option value="all">시간 선택</option>
                                {getAvailableHours().map(hour => (
                                    <option key={String(hour)} value={String(hour)}>{hour}시</option>))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* PC 테이블 뷰 */}
                <div className="table-responsive">
                    <table className="sales-table">
                        <thead>
                        <tr>
                            <th onClick={() => requestSort('created_at')}>날짜/시간 {getSortIndicator('created_at')}</th>
                            <th onClick={() => requestSort('display_id')}>주문번호 {getSortIndicator('display_id')}</th>
                            <th onClick={() => requestSort('menu_name')}>메뉴명 {getSortIndicator('menu_name')}</th>
                            <th onClick={() => requestSort('quantity')}>수량 {getSortIndicator('quantity')}</th>
                            <th onClick={() => requestSort('total_price')}>금액 {getSortIndicator('total_price')}</th>
                            <th onClick={() => requestSort('payment_method')}>결제수단 {getSortIndicator('payment_method')}</th>
                            <th onClick={() => requestSort('staff_name')}>담당자 {getSortIndicator('staff_name')}</th>
                            <th>관리</th>
                        </tr>
                        </thead>
                        <tbody>
                        {sortedData.length === 0 ? (
                            <tr>
                                <td colSpan="8"
                                    style={{padding: '30px', textAlign: 'center', color: 'var(--text-secondary)'}}>데이터가
                                    없습니다.
                                </td>
                            </tr>
                        ) : (
                            sortedData.map(item => (
                                <tr key={item.id}>
                                    <td>{new Date(item.created_at).toLocaleString('ko-KR', {
                                        year: 'numeric',
                                        month: '2-digit',
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        hour12: false
                                    })}</td>
                                    <td style={{
                                        fontSize: '0.85rem',
                                        color: 'var(--text-secondary)'
                                    }}>{item.display_id}</td>
                                    <td style={{fontWeight: 'bold'}}>{item.menu_name}</td>
                                    <td>{item.quantity}</td>
                                    <td className="text-red"
                                        style={{fontWeight: 'bold'}}>{item.total_price.toLocaleString()}원
                                    </td>
                                    <td>
                                        <span
                                            className={`pay-badge ${item.payment_method === 'bank' ? 'pay-bank' : (item.payment_method === 'event' ? 'pay-event' : 'pay-cash')}`}>
                                            {item.payment_method === 'bank' ? '🏦 계좌' : (item.payment_method === 'event' ? '🎁 이벤트' : '💵 현금')}
                                        </span>
                                    </td>
                                    <td className="text-blue" style={{fontWeight: 'bold'}}>{item.staff_name || '-'}</td>
                                    <td>
                                        <button onClick={() => handleDelete(item.id)} className="btn-del">삭제</button>
                                    </td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>

                {/* 모바일 카드 뷰 */}
                <div className="sales-card-view">
                    {sortedData.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '30px', color: 'var(--text-secondary)'}}>데이터가
                            없습니다.</div>
                    ) : (
                        sortedData.map(item => (
                            <div key={item.id} className="mobile-card">
                                <div className="mc-header">
                                    <span>{new Date(item.created_at).toLocaleString('ko-KR', {
                                        year: '2-digit',
                                        month: '2-digit',
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        hour12: false
                                    })}</span>
                                    <span style={{fontFamily: 'monospace'}}>{item.display_id}</span>
                                </div>
                                <div className="mc-body">
                                    <div className="mc-menu">{item.menu_name} <span style={{
                                        fontSize: '0.9rem',
                                        fontWeight: 'normal',
                                        backgroundColor: 'var(--bg-color)',
                                        padding: '2px 6px',
                                        borderRadius: '5px'
                                    }}>x{item.quantity}</span></div>
                                    <div className="mc-price">{item.total_price.toLocaleString()}원</div>
                                </div>
                                <div className="mc-footer">
                                    <span style={{
                                        fontSize: '0.85rem',
                                        color: '#1565c0',
                                        fontWeight: 'bold',
                                        backgroundColor: 'rgba(21,101,192,0.1)',
                                        padding: '4px 8px',
                                        borderRadius: '4px'
                                    }}>👤 {item.staff_name || '-'}</span>
                                    <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                                        <span
                                            className={`pay-badge ${item.payment_method === 'bank' ? 'pay-bank' : (item.payment_method === 'event' ? 'pay-event' : 'pay-cash')}`}>
                                            {item.payment_method === 'bank' ? '🏦 계좌' : (item.payment_method === 'event' ? '🎁 이벤트' : '💵 현금')}
                                        </span>
                                        <button onClick={() => handleDelete(item.id)} className="btn-del">삭제</button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default SalesDashboard;