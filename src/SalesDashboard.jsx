// TODO: 다크 / 라이트 / 시스템 테마 제작 및 적용

import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import AdvancedStats from "./AdvancedStats.jsx";

function SalesDashboard({ onBack }) {
    const [salesData, setSalesData] = useState([]);
    const [loading, setLoading] = useState(true);

    const [selectedYear, setSelectedYear] = useState('all');
    const [selectedMonth, setSelectedMonth] = useState('all');
    const [selectedDay, setSelectedDay] = useState('all');
    const [selectedHour, setSelectedHour] = useState('all');
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');

    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'default' });
    const [showAdvanced, setShowAdvanced] = useState(false);

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
        if (selectedHour !== 'all') {
            const hour = parseInt(selectedHour);
            target = target.filter(item => new Date(item.created_at).getHours() === hour);
        }
        if (selectedPaymentMethod !== 'all') {
            target = target.filter(item => item.payment_method === selectedPaymentMethod);
        }
        return target;
    }, [salesData, selectedYear, selectedMonth, selectedDay, selectedHour, selectedPaymentMethod]);

    const sortedData = useMemo(() => {
        let sortableItems = [...filteredData];
        if (sortConfig.key !== null && sortConfig.direction !== 'default') {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];
                if (aValue === null || aValue === undefined) aValue = '';
                if (bValue === null || bValue === undefined) bValue = '';

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

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') direction = 'desc';
            else if (sortConfig.direction === 'desc') direction = 'default';
        }
        setSortConfig({ key, direction });
    };

    const getSortIndicator = (name) => {
        if (sortConfig.key !== name || sortConfig.direction === 'default') return ' -';
        if (sortConfig.direction === 'asc') return ' ▲';
        if (sortConfig.direction === 'desc') return ' ▼';
        return ' -';
    };

    const stats = useMemo(() => {
        const getKSTDateStr = (isoString) => {
            return new Date(isoString).toLocaleString('en-CA', { hour12: false, timeZone: 'Asia/Seoul' }).slice(0, 10);
        };
        const todayKST = getKSTDateStr(new Date().toISOString());
        const monthKST = todayKST.slice(0, 7);

        const todaySum = salesData.filter(item => getKSTDateStr(item.created_at) === todayKST).reduce((acc, cur) => acc + cur.total_price, 0);
        const monthSum = salesData.filter(item => getKSTDateStr(item.created_at).startsWith(monthKST)).reduce((acc, cur) => acc + cur.total_price, 0);
        const filteredTotal = filteredData.reduce((acc, cur) => acc + cur.total_price, 0);

        return { today: todaySum, month: monthSum, count: filteredData.length, filteredTotal: filteredTotal };
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
            '결제금액': item.total_price,
            '결제수단': item.payment_method === 'bank' ? '계좌이체' : '현금',
            '담당자': item.staff_name
        }));
        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "매출내역");

        let fileName = '매출내역';
        if (selectedYear !== 'all') fileName += `_${selectedYear}년`;
        if (selectedMonth !== 'all') fileName += `_${selectedMonth}월`;
        if (selectedDay !== 'all') fileName += `_${selectedDay}일`;
        if (selectedHour !== 'all') fileName += `_${selectedHour}시`;
        if (selectedPaymentMethod !== 'all') fileName += `_${selectedPaymentMethod === 'bank' ? '계좌이체' : '현금'}`;

        XLSX.writeFile(wb, `${fileName}.xlsx`);
    };

    const getAvailableYears = () => Array.from(new Set(salesData.map(item => new Date(item.created_at).getFullYear()))).sort((a, b) => b - a);
    const getAvailableMonths = () => {
        if (selectedYear === 'all') return [];
        return Array.from(new Set(salesData.filter(item => new Date(item.created_at).getFullYear() === parseInt(selectedYear)).map(item => new Date(item.created_at).getMonth() + 1))).sort((a, b) => a - b);
    };
    const getAvailableDays = () => {
        if (selectedYear === 'all' || selectedMonth === 'all') return [];
        return Array.from(new Set(salesData.filter(item => {
            const d = new Date(item.created_at);
            return d.getFullYear() === parseInt(selectedYear) && (d.getMonth() + 1) === parseInt(selectedMonth);
        }).map(item => new Date(item.created_at).getDate()))).sort((a, b) => a - b);
    };
    const getAvailableHours = () => {
        if (selectedYear === 'all' || selectedMonth === 'all' || selectedDay === 'all') return [];
        return Array.from(new Set(salesData.filter(item => {
            const d = new Date(item.created_at);
            return d.getFullYear() === parseInt(selectedYear) &&
                (d.getMonth() + 1) === parseInt(selectedMonth) &&
                d.getDate() === parseInt(selectedDay);
        }).map(item => new Date(item.created_at).getHours()))).sort((a, b) => a - b);
    };

    const resetFilters = () => {
        setSelectedYear('all');
        setSelectedMonth('all');
        setSelectedDay('all');
        setSelectedHour('all');
        setSelectedPaymentMethod('all');
        setSortConfig({ key: null, direction: 'default' });
    };

    const periodLabel = useMemo(() => {
        let label = '';
        if (selectedYear === 'all') label = '전체 기간';
        else if (selectedMonth === 'all') label = `${selectedYear}년`;
        else if (selectedDay === 'all') label = `${selectedYear}년 ${selectedMonth}월`;
        else if (selectedHour === 'all') label = `${selectedYear}년 ${selectedMonth}월 ${selectedDay}일`;
        else label = `${selectedYear}년 ${selectedMonth}월 ${selectedDay}일 ${selectedHour}시`;

        if (selectedPaymentMethod !== 'all') {
            label += ` (${selectedPaymentMethod === 'bank' ? '계좌이체' : '현금'})`;
        }
        return label;
    }, [selectedYear, selectedMonth, selectedDay, selectedHour, selectedPaymentMethod]);

    if (loading) return <div style={{padding:'50px', textAlign:'center', color: 'var(--text-secondary)'}}>데이터를 불러오는 중입니다...</div>;
    if (showAdvanced) return <AdvancedStats onBack={() => setShowAdvanced(false)} />;

    return (
        <div className="sales-container">
            <style>
                {`
                .sales-container {
                    padding: 20px;
                    background-color: var(--bg-color, #f4f6f8);
                    height: 100vh;
                    display: flex; flex-direction: column;
                    box-sizing: border-box;
                    transition: background-color 0.3s ease;
                    overflow: hidden;
                }
                
                .sales-header { 
                    display: flex; justify-content: space-between; align-items: center; 
                    margin-bottom: 20px; flex-shrink: 0; flex-wrap: nowrap;
                    gap: 10px;
                }
                .header-left { display: flex; align-items: center; gap: 12px; }
                .sales-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                
                .header-right { display: flex; gap: 10px; align-items: center; }

                .btn-back { padding: 10px 15px; background-color: #6c757d; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; white-space: nowrap; }
                .btn-advanced { padding: 10px 15px; background-color: #673ab7; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); white-space: nowrap; }
                .btn-excel { padding: 10px 15px; background-color: #217346; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); white-space: nowrap; }
                
                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 25px; flex-shrink: 0; }
                .stat-card { background-color: var(--card-bg, white); padding: 25px 20px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; border: 1px solid var(--border-color, transparent); transition: background-color 0.3s ease; }
                .stat-title { margin: 0 0 10px 0; font-size: 1rem; color: var(--text-secondary, #666); font-weight: bold; }
                .stat-val { margin: 0; font-size: 1.8rem; font-weight: 800; color: var(--text-primary, #333); }
                .stat-val.green { color: #2e7d32; }
                .stat-val.blue { color: #1565c0; }

                .table-card { 
                    background-color: var(--card-bg, white); padding: 25px; border-radius: 20px; 
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid var(--border-color, transparent); 
                    flex: 1; display: flex; flex-direction: column; min-height: 0; 
                }
                
                .filter-area { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; flex-shrink: 0; }
                .filter-title { margin: 0; font-size: 1.3rem; color: var(--text-primary, #333); display: flex; align-items: center; gap: 10px; }
                
                .filter-group { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
                .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
                
                .filter-select { 
                    height: 36px; padding: 0 12px; font-size: 0.95rem; border-radius: 8px; border: 1px solid var(--border-color, #ccc); background-color: var(--card-bg, white); color: var(--text-primary, #333); outline: none; cursor: pointer; box-sizing: border-box;
                }
                .btn-filter { 
                    height: 36px; padding: 0 15px; border-radius: 8px; border: none; color: white; cursor: pointer; font-weight: bold; font-size: 0.9rem; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
                }

                .table-responsive { flex: 1; overflow-y: auto; overflow-x: auto; min-height: 0; }
                
                .sales-table { width: 100%; border-collapse: collapse; text-align: center; }
                .sales-table th { padding: 15px; border-bottom: 2px solid var(--border-color, #ddd); font-weight: bold; color: var(--text-secondary, #666); position: sticky; top: 0; background-color: var(--card-bg, white); cursor: pointer; user-select: none; white-space: nowrap; z-index: 10; }
                .sales-table td { padding: 12px; border-bottom: 1px solid var(--border-color, #eee); color: var(--text-primary, #333); font-size: 0.95rem; white-space: nowrap; }
                
                .btn-del { padding: 6px 12px; background-color: #ffebee; color: #dc3545; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; transition: background-color 0.2s; }
                .btn-del:active { background-color: #f8d7da; }

                .pay-badge { padding: 4px 8px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; display: inline-block; min-width: 60px; text-align: center; }
                .pay-cash { background-color: rgba(46, 125, 50, 0.1); color: #2e7d32; }
                .pay-bank { background-color: rgba(237, 108, 2, 0.1); color: #ed6c02; }

                .sales-card-view { display: none; }

                /* 📱 모바일 화면 최적화 (768px 이하) */
                @media (max-width: 768px) {
                    .sales-container { 
                        height: auto;
                        min-height: 100vh;
                        padding: 15px; 
                        overflow: visible;
                    }
                    
                    .sales-header { 
                        flex-direction: column; 
                        align-items: flex-start; /* 🌟 픽스: 전체를 왼쪽으로 정렬 */
                        gap: 12px; 
                    }
                    .header-left { 
                        justify-content: flex-start; /* 🌟 픽스: space-between 제거하고 왼쪽 정렬 */
                        width: 100%; 
                        gap: 10px;
                    }
                    .sales-title { font-size: 1.5rem; }
                    .btn-back { padding: 8px 12px; font-size: 0.85rem; }
                    
                    .header-right { 
                        width: 100%; 
                        justify-content: flex-start; /* 버튼들도 컨테이너 안에서 정렬 맞춤 */
                        gap: 10px;
                    }
                    .btn-advanced { padding: 8px 12px; font-size: 0.85rem; flex: 1; justify-content: center; }
                    .btn-excel { padding: 8px 12px; font-size: 0.85rem; flex: 1; justify-content: center; }


                    .stats-grid { grid-template-columns: 1fr; gap: 12px; } 
                    .stat-card { padding: 20px 15px; }
                    .table-card { padding: 15px; background-color: transparent; box-shadow: none; border: none; flex: none; display: block; } 
                    .table-responsive { display: none; } 
                    .sales-card-view { display: flex; flex-direction: column; gap: 12px; } 
                    
                    .filter-area { flex-direction: column; align-items: stretch; gap: 12px; }
                    .filter-title { margin-bottom: 0; }
                    .filter-group { width: 100%; flex-direction: column; gap: 8px; }
                    
                    .filter-row { display: grid; width: 100%; gap: 8px; }
                    .filter-row.top-row { grid-template-columns: 1fr 2fr; } 
                    .filter-row.bottom-row { grid-template-columns: repeat(4, 1fr); } 
                    
                    .filter-select { padding: 0 4px; font-size: 0.85rem; text-align: center; }
                    .btn-filter { padding: 0; font-size: 0.9rem; }
                    
                    .mobile-card {
                        background-color: var(--card-bg, white);
                        border-radius: 15px; padding: 15px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        border: 1px solid var(--border-color, #eee);
                        display: flex; flex-direction: column; gap: 10px;
                    }
                    .mc-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-color, #ddd); padding-bottom: 8px; }
                    .mc-date { font-size: 0.85rem; color: var(--text-secondary, #666); }
                    .mc-id { font-size: 0.85rem; color: var(--text-secondary, #999); font-family: monospace; }
                    
                    .mc-body { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; }
                    .mc-menu { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); display: flex; align-items: center; gap: 8px; }
                    .mc-qty { font-size: 0.9rem; color: var(--text-secondary, #888); font-weight: normal; background-color: var(--bg-color, #f4f6f8); padding: 2px 6px; border-radius: 5px; }
                    .mc-price { font-size: 1.1rem; font-weight: bold; color: #d32f2f; }
                    
                    .mc-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 5px; }
                    .mc-staff { font-size: 0.85rem; color: #1565c0; font-weight: bold; background-color: rgba(21,101,192,0.1); padding: 4px 8px; border-radius: 6px; }
                }
                `}
            </style>

            <div className="sales-header">
                <div className="header-left">
                    <button onClick={onBack} className="btn-back">⬅ 뒤로</button>
                    <h2 className="sales-title">💰 매출 통계</h2>
                </div>
                <div className="header-right">
                    <button onClick={() => setShowAdvanced(true)} className="btn-advanced">
                        📊 고급 통계
                    </button>
                    <button onClick={exportExcel} className="btn-excel">
                        📗 엑셀 다운로드
                    </button>
                </div>
            </div>

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

            <div className="table-card">
                <div className="filter-area">
                    <h3 className="filter-title">상세 내역</h3>

                    <div className="filter-group">
                        <div className="filter-row top-row">
                            <button onClick={resetFilters} className="btn-filter" style={{backgroundColor: selectedYear === 'all' && selectedPaymentMethod === 'all' ? '#007bff' : '#6c757d'}}>
                                초기화
                            </button>
                            <select value={selectedPaymentMethod} onChange={(e) => setSelectedPaymentMethod(e.target.value)} className="filter-select" style={{borderColor: selectedPaymentMethod !== 'all' ? '#007bff' : 'var(--border-color, #ccc)'}}>
                                <option value="all">결제수단: 전체</option>
                                <option value="cash">현금</option>
                                <option value="bank">계좌이체</option>
                            </select>
                        </div>

                        <div className="filter-row bottom-row">
                            <select value={selectedYear} onChange={(e) => { setSelectedYear(e.target.value); setSelectedMonth('all'); setSelectedDay('all'); setSelectedHour('all'); }} className="filter-select">
                                <option value="all">연도 선택</option>
                                {getAvailableYears().map(year => (<option key={year} value={year}>{year}년</option>))}
                            </select>
                            <select value={selectedMonth} onChange={(e) => { setSelectedMonth(e.target.value); setSelectedDay('all'); setSelectedHour('all'); }} className="filter-select" disabled={selectedYear === 'all'}>
                                <option value="all">월 선택</option>
                                {getAvailableMonths().map(month => (<option key={month} value={month}>{month}월</option>))}
                            </select>
                            <select value={selectedDay} onChange={(e) => { setSelectedDay(e.target.value); setSelectedHour('all'); }} className="filter-select" disabled={selectedMonth === 'all'}>
                                <option value="all">일 선택</option>
                                {getAvailableDays().map(day => (<option key={day} value={day}>{day}일</option>))}
                            </select>
                            <select value={selectedHour} onChange={(e) => setSelectedHour(e.target.value)} className="filter-select" disabled={selectedDay === 'all'}>
                                <option value="all">시간 선택</option>
                                {getAvailableHours().map(hour => (<option key={hour} value={hour}>{hour}시</option>))}
                            </select>
                        </div>
                    </div>
                </div>

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
                            <tr><td colSpan="8" style={{padding: '30px', textAlign: 'center', color: 'var(--text-secondary)'}}>데이터가 없습니다.</td></tr>
                        ) : (
                            sortedData.map(item => (
                                <tr key={item.id}>
                                    <td>
                                        {new Date(item.created_at).toLocaleString('ko-KR', {
                                            year: 'numeric', month: '2-digit', day: '2-digit',
                                            hour: '2-digit', minute: '2-digit', hour12: false
                                        })}
                                    </td>
                                    <td style={{fontSize:'0.85rem', color:'var(--text-secondary)'}}>{item.display_id}</td>
                                    <td style={{fontWeight:'bold'}}>{item.menu_name}</td>
                                    <td>{item.quantity}</td>
                                    <td style={{color:'#d32f2f', fontWeight:'bold'}}>{item.total_price.toLocaleString()}원</td>
                                    <td>
                                        <span className={`pay-badge ${item.payment_method === 'bank' ? 'pay-bank' : 'pay-cash'}`}>
                                            {item.payment_method === 'bank' ? '🏦 계좌' : '💵 현금'}
                                        </span>
                                    </td>
                                    <td style={{color: '#1565c0', fontWeight: 'bold'}}>{item.staff_name || '-'}</td>
                                    <td>
                                        <button onClick={() => handleDelete(item.id)} className="btn-del">삭제</button>
                                    </td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>

                <div className="sales-card-view">
                    {sortedData.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '30px', color: 'var(--text-secondary)'}}>데이터가 없습니다.</div>
                    ) : (
                        sortedData.map(item => (
                            <div key={item.id} className="mobile-card">
                                <div className="mc-header">
                                    <span className="mc-date">
                                        {new Date(item.created_at).toLocaleString('ko-KR', {
                                            year: '2-digit', month: '2-digit', day: '2-digit',
                                            hour: '2-digit', minute: '2-digit', hour12: false
                                        })}
                                    </span>
                                    <span className="mc-id">{item.display_id}</span>
                                </div>
                                <div className="mc-body">
                                    <div className="mc-menu">
                                        {item.menu_name} <span className="mc-qty">x{item.quantity}</span>
                                    </div>
                                    <div className="mc-price">{item.total_price.toLocaleString()}원</div>
                                </div>
                                <div className="mc-footer">
                                    <span className="mc-staff">👤 {item.staff_name || '-'}</span>
                                    <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                                        <span className={`pay-badge ${item.payment_method === 'bank' ? 'pay-bank' : 'pay-cash'}`}>
                                            {item.payment_method === 'bank' ? '🏦 계좌' : '💵 현금'}
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