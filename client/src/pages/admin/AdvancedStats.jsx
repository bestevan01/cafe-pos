import { useState, useEffect } from 'react';
import axios from 'axios';
import ThemeToggle from '../../components/ThemeToggle';
import { useNotification } from '../../hooks/useNotification';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import BarList from '../../components/stats/BarList';
import BarChart from '../../components/stats/BarChart';

function AdvancedStats({ onBack }) {
    const { notify } = useNotification();
    const [stats, setStats] = useState({ itemStats: [], timeStats: [] });
    const [loading, setLoading] = useState(true);

    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    useEffect(() => {
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

    // 새 통계 추가 = 아래에 <StatCard><차트/></StatCard> 한 덩어리만 더 넣으면 된다.
    return (
        <StatsLayout title="📊 고급 매출 분석" onBack={onBack} actions={<ThemeToggle />}>
            <StatCard
                title="메뉴별 인기 순위"
                icon="🍔"
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

            <StatCard title="시간대별 매출 추이" icon="⏰" loading={loading} empty={stats.timeStats.length === 0}>
                <BarChart
                    data={stats.timeStats}
                    label={(t) => `${t.hour}시`}
                    value={(t) => t.total_sales}
                    color="#4caf50"
                />
            </StatCard>
        </StatsLayout>
    );
}

export default AdvancedStats;
