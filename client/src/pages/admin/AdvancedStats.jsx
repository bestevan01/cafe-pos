import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { socket } from '../../utils/socket';
import ThemeToggle from '../../components/ThemeToggle';
import { useNotification } from '../../hooks/useNotification';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import BarList from '../../components/stats/BarList';
import BarChart from '../../components/stats/BarChart';
import SummaryTiles from '../../components/stats/SummaryTiles';

// DAYOFWEEK는 1=일 ~ 7=토. 읽는 순서를 월~일로 바꾸고, 주문이 없던 요일도 0으로 채워
// 한 주가 통째로 보이게 한다. 빈 요일이 빠지면 '금요일이 얼마나 되나'를 눈으로 비교할 수 없다.
const WEEK = [
    { dow: 2, name: '월' },
    { dow: 3, name: '화' },
    { dow: 4, name: '수' },
    { dow: 5, name: '목' },
    { dow: 6, name: '금' },
    { dow: 7, name: '토' },
    { dow: 1, name: '일' },
];

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
function AdvancedStats({ onBack }) {
    const { notify } = useNotification();
    const [stats, setStats] = useState(
        /** @type {{itemStats: any[], timeStats: any[], dowStats: any[], summary: any}} */ ({
            itemStats: [],
            timeStats: [],
            dowStats: [],
            summary: { totalSales: 0, orderCount: 0, avgOrderValue: 0 },
        }),
    );
    const [loading, setLoading] = useState(true);

    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    // 소켓에서도 다시 부를 수 있게 함수로 뺀다.
    const fetchStats = useCallback(() => {
        axios
            .get('/api/admin/stats', getAuthHeader())
            .then((res) => {
                setStats(res.data);
                setLoading(false);
            })
            .catch((err) => {
                console.error(err);
                notify('통계 로딩 실패', { icon: '⚠️' });
                setLoading(false);
            });
    }, [notify]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    // 캐셔가 주문을 받는 동안 숫자가 멈춰 있지 않도록 다시 불러온다. 보기 전용 화면이다.
    useEffect(() => {
        socket.on('new_order', fetchStats);
        socket.on('order_updated', fetchStats);
        socket.on('order_deleted', fetchStats);
        return () => {
            socket.off('new_order', fetchStats);
            socket.off('order_updated', fetchStats);
            socket.off('order_deleted', fetchStats);
        };
    }, [fetchStats]);

    const weekSales = WEEK.map((d) => {
        const hit = stats.dowStats.find((/** @type {any} */ r) => Number(r.dow) === d.dow);
        return {
            name: d.name,
            total_sales: hit ? Number(hit.total_sales) : 0,
            order_count: hit ? Number(hit.order_count) : 0,
        };
    });
    const busiest = weekSales.reduce((a, b) => (b.total_sales > a.total_sales ? b : a), weekSales[0]);

    // 큰 금액은 '만' 단위로 줄여 타일 폭을 넘지 않게 한다.
    /** @param {number} n */
    const won = (n) => (n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만원` : `${n.toLocaleString()}원`);
    const sum = stats.summary || { totalSales: 0, orderCount: 0, avgOrderValue: 0 };
    const summaryItems = [
        { label: '총 매출', value: won(sum.totalSales) },
        { label: '주문 건수', value: `${Number(sum.orderCount).toLocaleString()}건` },
        { label: '객단가', value: `${Number(sum.avgOrderValue).toLocaleString()}원`, hint: '주문 1건당 평균' },
        {
            label: '최다 요일',
            value: busiest && busiest.total_sales > 0 ? `${busiest.name}요일` : '-',
            hint: busiest && busiest.total_sales > 0 ? won(busiest.total_sales) : undefined,
        },
    ];

    // 새 통계 추가 = 아래에 <StatCard><차트/></StatCard> 한 덩어리만 더 넣으면 된다.
    return (
        <StatsLayout
            title="📊 고급 매출 분석"
            onBack={onBack}
            actions={<ThemeToggle />}
            summary={<SummaryTiles items={summaryItems} loading={loading} />}
        >
            {/* 성격이 같은 '구간별 매출' 두 개를 나란히 두어 서로 비교되게 한다 */}
            <StatCard title="시간대별 매출" icon="⏰" loading={loading} empty={stats.timeStats.length === 0}>
                <BarChart
                    data={stats.timeStats}
                    label={(t) => `${t.hour}시`}
                    value={(t) => t.total_sales}
                    color="#4caf50"
                />
            </StatCard>

            <StatCard
                title="요일별 매출"
                icon="📅"
                loading={loading}
                empty={stats.dowStats.length === 0}
                subtitle={
                    stats.dowStats.length > 0 && busiest.total_sales > 0
                        ? `가장 많은 요일: ${busiest.name} (${busiest.order_count.toLocaleString()}건)`
                        : null
                }
            >
                <BarChart data={weekSales} label={(d) => d.name} value={(d) => d.total_sales} color="#7e57c2" />
            </StatCard>

            {/* 메뉴는 개수만큼 목록이 길어지므로 한 줄 전체를 쓴다 */}
            <StatCard
                title="메뉴별 인기 순위"
                icon="🍔"
                wide
                loading={loading}
                empty={stats.itemStats.length === 0}
                subtitle={stats.itemStats.length > 0 ? `${stats.itemStats.length}개 메뉴` : null}
            >
                <BarList
                    data={stats.itemStats}
                    label={(i) => i.menu_name}
                    value={(i) => i.total_sales}
                    sublabel={(i) =>
                        `${Number(i.total_qty).toLocaleString()}잔 · ${Number(i.total_sales).toLocaleString()}원`
                    }
                    highlightTop={3}
                />
            </StatCard>
        </StatsLayout>
    );
}

export default AdvancedStats;
