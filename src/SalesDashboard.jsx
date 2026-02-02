import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import AdvancedStats from "./AdvancedStats.jsx";

function SalesDashboard({ onBack }) {
    // 1. 상태 관리
    const [salesData, setSalesData] = useState([]);
    const [loading, setLoading] = useState(true);

    // 🗓️ 날짜 필터 상태
    const [selectedYear, setSelectedYear] = useState('all');
    const [selectedMonth, setSelectedMonth] = useState('all');
    const [selectedDay, setSelectedDay] = useState('all');

    // 🔃 정렬 상태 (key: 정렬할 컬럼명, direction: 'asc' | 'desc' | 'default')
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'default' });

    const [showAdvanced, setShowAdvanced] = useState(false);

    // 2. 초기 데이터 로딩
    useEffect(() => {
        fetchSales();
    }, []);

    const fetchSales = async () => {
        try {
            setLoading(true);
            const res = await axios.get('/api/admin/sales');
            setSalesData(res.data);
            setLoading(false);
        } catch (err) {
            alert('데이터 로딩 실패');
            setLoading(false);
        }
    };

    // 3. 필터링 로직
    const filteredData = useMemo(() => {
        let target = salesData;

        if (selectedYear !== 'all') {
            const year = parseInt(selectedYear);
            target = target.filter(item => new Date(item.created_at).getFullYear() === year);
        }
        if (selectedMonth !== 'all') {
            const month = parseInt(selectedMonth);
            target = target.filter(item => (new Date(item.created_at).getMonth() + 1) === month);
        }
        if (selectedDay !== 'all') {
            const day = parseInt(selectedDay);
            target = target.filter(item => new Date(item.created_at).getDate() === day);
        }
        return target;
    }, [salesData, selectedYear, selectedMonth, selectedDay]);

    // 4. [정렬 로직] 필터링된 데이터를 정렬 설정에 맞춰 재정렬
    const sortedData = useMemo(() => {
        let sortableItems = [...filteredData];

        if (sortConfig.key !== null && sortConfig.direction !== 'default') {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                if (sortConfig.key === 'created_at') {
                    aValue = new Date(aValue);
                    bValue = new Date(bValue);
                } else if (typeof aValue === 'string') {
                    return sortConfig.direction === 'asc'
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredData, sortConfig]);

    // 정렬 핸들러: 오름차순 -> 내림차순 -> 기본 순환
    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') {
                direction = 'desc';
            } else if (sortConfig.direction === 'desc') {
                direction = 'default';
            }
        }
        setSortConfig({ key, direction });
    };

    // ✅ [수정됨] 헤더에 표시할 기호 (이모티콘 대신 텍스트 기호 사용)
    const getSortIndicator = (name) => {
        // 정렬 기준이 아니거나 기본 상태일 때: '-' (하이픈)
        if (sortConfig.key !== name || sortConfig.direction === 'default') return ' -';
        // 오름차순: '^' (위쪽 꺽쇠)
        if (sortConfig.direction === 'asc') return ' ^';
        // 내림차순: 'v' (아래쪽 꺽쇠)
        if (sortConfig.direction === 'desc') return ' v';
        return ' -';
    };

    // 📊 통계 계산
    const stats = useMemo(() => {
        const getKSTDateStr = (isoString) => {
            return new Date(isoString).toLocaleString('en-CA', { hour12: false, timeZone: 'Asia/Seoul' }).slice(0, 10);
        };
        const todayKST = getKSTDateStr(new Date().toISOString());
        const monthKST = todayKST.slice(0, 7);

        const todaySum = salesData
            .filter(item => getKSTDateStr(item.created_at) === todayKST)
            .reduce((acc, cur) => acc + cur.total_price, 0);

        const monthSum = salesData
            .filter(item => getKSTDateStr(item.created_at).startsWith(monthKST))
            .reduce((acc, cur) => acc + cur.total_price, 0);

        const filteredTotal = filteredData.reduce((acc, cur) => acc + cur.total_price, 0);

        return {
            today: todaySum,
            month: monthSum,
            count: filteredData.length,
            filteredTotal: filteredTotal
        };
    }, [salesData, filteredData]);

    const handleDelete = async (id) => {
        if (!window.confirm('정말 삭제(환불) 처리하시겠습니까?')) return;
        try {
            await axios.delete(`/api/admin/sales/${id}`);
            fetchSales();
        } catch (err) {
            alert('삭제 실패');
        }
    };

    const exportExcel = () => {
        const excelData = sortedData.map(item => ({
            '날짜': new Date(item.created_at).toLocaleString('ko-KR'),
            '주문번호': item.display_id,
            '일일번호': item.daily_number,
            '메뉴명': item.menu_name,
            '수량': item.quantity,
            '결제금액': item.total_price
        }));

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "매출내역");

        let fileName = '매출내역';
        if (selectedYear !== 'all') fileName += `_${selectedYear}년`;
        if (selectedMonth !== 'all') fileName += `_${selectedMonth}월`;
        if (selectedDay !== 'all') fileName += `_${selectedDay}일`;

        XLSX.writeFile(wb, `${fileName}.xlsx`);
    };

    // --- 동적 필터 옵션 함수들 ---
    const getAvailableYears = () => {
        const years = new Set(salesData.map(item => new Date(item.created_at).getFullYear()));
        return Array.from(years).sort((a, b) => b - a);
    };

    const getAvailableMonths = () => {
        if (selectedYear === 'all') return [];
        const months = new Set(
            salesData
                .filter(item => new Date(item.created_at).getFullYear() === parseInt(selectedYear))
                .map(item => new Date(item.created_at).getMonth() + 1)
        );
        return Array.from(months).sort((a, b) => a - b);
    };

    const getAvailableDays = () => {
        if (selectedYear === 'all' || selectedMonth === 'all') return [];
        const days = new Set(
            salesData
                .filter(item => {
                    const d = new Date(item.created_at);
                    return d.getFullYear() === parseInt(selectedYear) && (d.getMonth() + 1) === parseInt(selectedMonth);
                })
                .map(item => new Date(item.created_at).getDate())
        );
        return Array.from(days).sort((a, b) => a - b);
    };

    const resetFilters = () => {
        setSelectedYear('all');
        setSelectedMonth('all');
        setSelectedDay('all');
        setSortConfig({ key: null, direction: 'default' });
    };

    if (loading) return <div style={{padding:'50px', textAlign:'center'}}>데이터를 불러오는 중입니다...</div>;

    if (showAdvanced) return <AdvancedStats onBack={() => setShowAdvanced(false)} />;

    return (
        <div style={containerStyle}>
            {/* 헤더 */}
            <div style={headerStyle}>
                <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
                    <button onClick={onBack} style={backBtnStyle}>⬅ 뒤로</button>
                    <h2 style={{margin:0}}>💰 매출 통계</h2>
                    <button
                        onClick={() => setShowAdvanced(true)}
                        style={{
                            padding: '10px 15px',
                            backgroundColor: '#673ab7',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '5px',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                        }}
                    >
                        📊 고급 통계 분석
                    </button>
                </div>
                <button onClick={exportExcel} style={excelBtnStyle}>📊 엑셀 다운로드</button>
            </div>

            {/* 상단 요약 카드 */}
            <div style={statsContainer}>
                <div style={cardStyle}>
                    <h3>📅 오늘 매출</h3>
                    <p style={moneyStyle}>{stats.today.toLocaleString()}원</p>
                </div>
                <div style={cardStyle}>
                    <h3>🗓 이번 달 매출</h3>
                    <p style={{...moneyStyle, color: '#2e7d32'}}>{stats.month.toLocaleString()}원</p>
                </div>
                <div style={cardStyle}>
                    <h3>🧾 조회된 주문 수</h3>
                    <p style={{...moneyStyle, color: '#1565c0'}}>{stats.count}건</p>
                </div>
            </div>

            {/* 필터 및 테이블 영역 */}
            <div style={tableCardStyle}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px', alignItems:'center', flexWrap: 'wrap', gap: '10px'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                        <h3 style={{margin:0}}>상세 내역</h3>
                        <span style={{fontSize: '1.1rem', fontWeight: 'bold', color: '#2e7d32'}}>
                            (총 {stats.filteredTotal.toLocaleString()}원)
                        </span>
                    </div>

                    <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                        <button
                            onClick={resetFilters}
                            style={{...filterBtnStyle, backgroundColor: (selectedYear === 'all') ? '#007bff' : '#6c757d'}}
                        >
                            전체 보기
                        </button>
                        <select
                            value={selectedYear}
                            onChange={(e) => { setSelectedYear(e.target.value); setSelectedMonth('all'); setSelectedDay('all'); }}
                            style={selectStyle}
                        >
                            <option value="all">연도 선택</option>
                            {getAvailableYears().map(year => (<option key={year} value={year}>{year}년</option>))}
                        </select>
                        <select
                            value={selectedMonth}
                            onChange={(e) => { setSelectedMonth(e.target.value); setSelectedDay('all'); }}
                            style={selectStyle}
                            disabled={selectedYear === 'all'}
                        >
                            <option value="all">월 선택</option>
                            {getAvailableMonths().map(month => (<option key={month} value={month}>{month}월</option>))}
                        </select>
                        <select
                            value={selectedDay}
                            onChange={(e) => setSelectedDay(e.target.value)}
                            style={selectStyle}
                            disabled={selectedMonth === 'all'}
                        >
                            <option value="all">일 선택</option>
                            {getAvailableDays().map(day => (<option key={day} value={day}>{day}일</option>))}
                        </select>
                    </div>
                </div>

                <div style={{maxHeight: '500px', overflowY: 'auto'}}>
                    <table style={{width: '100%', borderCollapse: 'collapse'}}>
                        <thead style={{position:'sticky', top:0, backgroundColor:'#f8f9fa', zIndex: 1}}>
                        <tr style={{borderBottom: '2px solid #ddd', textAlign:'center', color: '#555'}}>
                            <th style={clickableThStyle} onClick={() => requestSort('created_at')}>
                                날짜/시간 {getSortIndicator('created_at')}
                            </th>
                            <th style={clickableThStyle} onClick={() => requestSort('display_id')}>
                                주문번호 {getSortIndicator('display_id')}
                            </th>
                            <th style={clickableThStyle} onClick={() => requestSort('menu_name')}>
                                메뉴명 {getSortIndicator('menu_name')}
                            </th>
                            <th style={clickableThStyle} onClick={() => requestSort('quantity')}>
                                수량 {getSortIndicator('quantity')}
                            </th>
                            <th style={clickableThStyle} onClick={() => requestSort('total_price')}>
                                금액 {getSortIndicator('total_price')}
                            </th>
                            <th style={thStyle}>관리</th>
                        </tr>
                        </thead>
                        <tbody>
                        {sortedData.length === 0 ? (
                            <tr>
                                <td colSpan="6" style={{padding: '30px', textAlign: 'center', color: '#666'}}>
                                    데이터가 없습니다.
                                </td>
                            </tr>
                        ) : (
                            sortedData.map(item => (
                                <tr key={item.id} style={{borderBottom: '1px solid #eee', textAlign:'center'}}>
                                    <td style={tdStyle}>
                                        {new Date(item.created_at).toLocaleString('ko-KR', {
                                            year: 'numeric', month: '2-digit', day: '2-digit',
                                            hour: '2-digit', minute: '2-digit', hour12: false
                                        })}
                                    </td>
                                    <td style={{...tdStyle, fontSize:'0.85rem', color:'#666'}}>{item.display_id}</td>
                                    <td style={{...tdStyle, fontWeight:'bold'}}>{item.menu_name}</td>
                                    <td style={tdStyle}>{item.quantity}</td>
                                    <td style={{...tdStyle, color:'#d32f2f'}}>{item.total_price.toLocaleString()}</td>
                                    <td style={tdStyle}>
                                        <button onClick={() => handleDelete(item.id)} style={delBtnStyle}>삭제</button>
                                    </td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// --- 스타일 ---
const containerStyle = { padding: '30px', backgroundColor: '#f4f6f8', minHeight: '100vh', color: '#333' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '30px', color: '#333' };
const backBtnStyle = { padding: '10px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const excelBtnStyle = { padding: '10px 20px', backgroundColor: '#217346', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };

const statsContainer = { display: 'flex', gap: '20px', marginBottom: '30px' };
const cardStyle = { flex: 1, backgroundColor: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', textAlign: 'center', border: 'none' };
const moneyStyle = { fontSize: '2rem', fontWeight: '800', margin: '10px 0 0 0', color: '#333' };

const tableCardStyle = { backgroundColor: 'white', padding: '30px', borderRadius: '15px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', border: 'none' };
const thStyle = { padding: '15px', fontWeight: 'bold' };
const clickableThStyle = { ...thStyle, cursor: 'pointer', userSelect: 'none' };

const tdStyle = { padding: '12px', fontSize: '0.95rem' };
const delBtnStyle = { padding: '5px 10px', backgroundColor: '#ff5252', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize:'0.8rem' };

const selectStyle = { padding: '8px 12px', fontSize: '0.95rem', borderRadius: '8px', border: '1px solid #ccc', backgroundColor: 'white', color: '#333', outline: 'none', cursor: 'pointer' };
const filterBtnStyle = { padding: '8px 15px', borderRadius: '8px', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' };

export default SalesDashboard;