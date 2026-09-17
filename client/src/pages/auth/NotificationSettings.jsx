import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import ThemeToggle from '../../components/ThemeToggle';
import PushSetup from '../../components/PushSetup';
import AlertSchedule from '../../components/AlertSchedule';
import MyAlerts from '../../components/MyAlerts';

/**
 * 알림 설정 화면.
 *
 * 알림은 받는 사람이 다르다. 한데 섞어 놓으면 카드 안의 작은 글씨를 읽어야 누구에게 가는지
 * 알 수 있어서, 받는 사람 기준으로 구역을 나눈다.
 *  - 관리자: '내가 받는 알림'(설정 가능) / '근무자에게 보내는 알림'(설정 가능)
 *  - 근무자: '내가 받는 알림'(읽기 전용 — 켜고 끄는 것은 관리자가 매장 단위로 한다)
 *
 * 기기에서 받을지(권한·푸시)는 사람마다 기기마다 다르므로 누구나 맨 위에서 켠다.
 *
 * @param {{onBack: () => void, isAdmin: boolean}} props
 */
function NotificationSettings({ onBack, isAdmin }) {
    return (
        <StatsLayout title="🔔 알림 설정" onBack={onBack} actions={<ThemeToggle />}>
            <style>{`
                .ns-section { grid-column: 1 / -1; margin: 12px 0 -8px; display: flex; align-items: baseline; gap: 10px; }
                .ns-section b { font-size: 1.02rem; font-weight: 800; color: var(--text-primary, #222); }
                .ns-section span { font-size: .8rem; color: var(--text-secondary, #999); }
            `}</style>

            <StatCard title="이 기기에서 알림 받기" icon="📱" wide>
                <PushSetup />
            </StatCard>

            {isAdmin ? (
                <>
                    <div className="ns-section">
                        <b>👤 관리자가 받는 알림</b>
                        <span>이 기기에서 알림을 켜 둔 관리자에게 갑니다</span>
                    </div>
                    <AlertSchedule
                        alertKey="inventory_low"
                        title="재고 주문 필요 알림"
                        hint="직원이 조사를 제출한 순간 '○봉 이하면 주문' 기준을 넘긴 품목이 있으면 바로 알립니다. 아래 시각을 정해두면 그때 한 번 더 확인해 알립니다. 부족한 품목이 없으면 울리지 않고, 같은 내용으로는 다시 울리지 않습니다."
                    />

                    <div className="ns-section">
                        <b>☕ 근무자에게 보내는 알림</b>
                        <span>여기서 켜고 끄면 이 매장 근무자 전원에게 적용됩니다</span>
                    </div>
                    <AlertSchedule
                        alertKey="inventory_count_reminder"
                        title="재고 조사 시각 알림"
                        hint="재고 조사 시각이 되면 근무자에게 조사할 시간이라고 알립니다. 누르면 재고 조사 화면이 바로 열립니다. 그 회차 조사를 이미 냈으면 알리지 않습니다."
                        timesFrom="시각은 재고 현황 → 품목 관리 → 조사 회차를 그대로 따라갑니다. 시각을 바꾸려면 그곳에서 회차를 바꿔주세요."
                    />
                </>
            ) : (
                <MyAlerts />
            )}
        </StatsLayout>
    );
}

export default NotificationSettings;
