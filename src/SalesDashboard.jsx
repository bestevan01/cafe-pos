import { useState, useEffect, useMemo } from 'react'; // ✅ useMemo 추가
import axios from 'axios';
import * as XLSX from 'xlsx';
import AdvancedStats from "./AdvancedStats.jsx";

function SalesDashboard({ onBack }) {
    // 1. 상태 관리: 원본 데이터만 state로 관리 (filteredData, stats 제거)
    const [salesData, setSalesData] = useState([]);
    const [loading, setLoading] = useState(true); // 로딩 상태 추가

    // 🗓️ 날짜 필터 상태
    const [selectedYear, setSelectedYear] = useState('all');
    const [selectedMonth, setSelectedMonth] = useState('all');
    const [selectedDay, setSelectedDay] = useState('all');

    const [showAdvanced, setShowAdvanced] = useState(false);

    // 2. 초기 데이터 로딩 (최초 1회만 실행)
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

    // 🚀 3. [최적화 핵심] 필터링 로직을 useMemo로 캐싱
    // 필터(Year, Month, Day)가 바뀔 때만 재계산하고, 그 외에는 기존 결과를 재사용
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

    // 📊 4. [최적화] 통계 계산도 useMemo로 실시간 처리
    const stats = useMemo(() => {
        const getKSTDateStr = (isoString) => {
            return new Date(isoString).toLocaleString('en-CA', { hour12: false, timeZone: 'Asia/Seoul' }).slice(0, 10);
        };

        // 현재 시간 기준 (KST)
        const todayKST = getKSTDateStr(new Date().toISOString());
        const monthKST = todayKST.slice(0, 7);

        // 전체 데이터(salesData) 기준으로 오늘/이번달 매출 계산 (필터 영향 X)
        const todaySum = salesData
            .filter(item => getKSTDateStr(item.created_at) === todayKST)
            .reduce((acc, cur) => acc + cur.total_price, 0);

        const monthSum = salesData
            .filter(item => getKSTDateStr(item.created_at).startsWith(monthKST))
            .reduce((acc, cur) => acc + cur.total_price, 0);

        // 현재 필터링된 목록의 총 합계
        const filteredTotal = filteredData.reduce((acc, cur) => acc + cur.total_price, 0);

        return {
            today: todaySum,
            month: monthSum,
            count: filteredData.length, // 필터링된 개수
            filteredTotal: filteredTotal // 필터링된 금액 합계
        };
    }, [salesData, filteredData]);


    const handleDelete = async (id) => {
        if (!window.confirm('정말 삭제(환불) 처리하시겠습니까?')) return;
        try {
            await axios.delete(`/api/admin/sales/${id}`);
            fetchSales(); // 삭제 후 데이터 재요청
        } catch (err) {
            alert('삭제 실패');
        }
    };

    const exportExcel = () => {
        const excelData = filteredData.map(item => ({
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

    // --- 동적 필터 옵션 (useMemo로 최적화 가능하지만 가독성을 위해 함수 유지) ---
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

                    {/* 상세 내역 제목 옆에 총합 표시 */}
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                        <h3 style={{margin:0}}>상세 내역</h3>
                        <span style={{fontSize: '1.1rem', fontWeight: 'bold', color: '#2e7d32'}}>
                            (총 {stats.filteredTotal.toLocaleString()}원)
                        </span>
                    </div>

                    <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                        {/* 전체 보기 버튼 */}
                        <button
                            onClick={resetFilters}
                            style={{...filterBtnStyle, backgroundColor: (selectedYear === 'all') ? '#007bff' : '#6c757d'}}
                        >
                            전체 보기
                        </button>

                        {/* 연도 선택 */}
                        <select
                            value={selectedYear}
                            onChange={(e) => {
                                setSelectedYear(e.target.value);
                                setSelectedMonth('all');
                                setSelectedDay('all');
                            }}
                            style={selectStyle}
                        >
                            <option value="all">연도 선택</option>
                            {getAvailableYears().map(year => (
                                <option key={year} value={year}>{year}년</option>
                            ))}
                        </select>

                        {/* 월 선택 */}
                        <select
                            value={selectedMonth}
                            onChange={(e) => {
                                setSelectedMonth(e.target.value);
                                setSelectedDay('all');
                            }}
                            style={selectStyle}
                            disabled={selectedYear === 'all'}
                        >
                            <option value="all">월 선택</option>
                            {getAvailableMonths().map(month => (
                                <option key={month} value={month}>{month}월</option>
                            ))}
                        </select>

                        {/* 일 선택 */}
                        <select
                            value={selectedDay}
                            onChange={(e) => setSelectedDay(e.target.value)}
                            style={selectStyle}
                            disabled={selectedMonth === 'all'}
                        >
                            <option value="all">일 선택</option>
                            {getAvailableDays().map(day => (
                                <option key={day} value={day}>{day}일</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{maxHeight: '500px', overflowY: 'auto'}}>
                    <table style={{width: '100%', borderCollapse: 'collapse'}}>
                        <thead style={{position:'sticky', top:0, backgroundColor:'#f8f9fa', zIndex: 1}}>
                        <tr style={{borderBottom: '2px solid #ddd', textAlign:'center', color: '#555'}}>
                            <th style={thStyle}>날짜/시간</th>
                            <th style={thStyle}>주문번호</th>
                            <th style={thStyle}>메뉴명</th>
                            <th style={thStyle}>수량</th>
                            <th style={thStyle}>금액</th>
                            <th style={thStyle}>관리</th>
                        </tr>
                        </thead>
                        <tbody>
                        {filteredData.length === 0 ? (
                            <tr>
                                <td colSpan="6" style={{padding: '30px', textAlign: 'center', color: '#666'}}>
                                    데이터가 없습니다.
                                </td>
                            </tr>
                        ) : (
                            filteredData.map(item => (
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
const tdStyle = { padding: '12px', fontSize: '0.95rem' };
const delBtnStyle = { padding: '5px 10px', backgroundColor: '#ff5252', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize:'0.8rem' };

const selectStyle = {
    padding: '8px 12px',
    fontSize: '0.95rem',
    borderRadius: '8px',
    border: '1px solid #ccc',
    backgroundColor: 'white',
    color: '#333',
    outline: 'none',
    cursor: 'pointer'
};

const filterBtnStyle = {
    padding: '8px 15px',
    borderRadius: '8px',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '0.9rem'
};

export default SalesDashboard;