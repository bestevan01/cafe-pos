import Button from '../ui/Button';

/**
 * 통계 페이지 공용 셸: 헤더(뒤로/제목/우측 액션) + 자동 정렬 카드 그리드.
 * 카드(StatCard)를 children으로 넣기만 하면 반응형으로 흐른다.
 *
 *   <StatsLayout title="📊 고급 매출 분석" onBack={onBack} actions={<ThemeToggle/>}>
 *     <StatCard ...>...</StatCard>
 *     <StatCard ...>...</StatCard>
 *   </StatsLayout>
 * @param {object} props
 * @param {string} props.title
 * @param {() => void} props.onBack
 * @param {import('react').ReactNode} props.actions  우측 상단 액션
 * @param {import('react').ReactNode} [props.summary]  그리드 위에 놓이는 요약 영역(선택)
 * @param {import('react').ReactNode} props.children
 */
function StatsLayout({ title, onBack, actions, summary, children }) {
    return (
        <div className="stats-layout">
            <style>{`
                .stats-layout { padding: 24px; min-height: 100dvh; background: var(--bg-color, #f4f6f8); box-sizing: border-box; transition: background-color .3s ease; }
                .stats-layout-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
                .stats-layout-left { display: flex; align-items: center; gap: 14px; }
                .stats-layout-title { margin: 0; font-size: 1.7rem; font-weight: 800; color: var(--text-primary, #222); white-space: nowrap; }
                /* 데스크탑 2열 고정: 카드가 좌→우로 채워지고, wide 카드만 한 줄 전체 차지 */
                .stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
                /* 모바일: minmax(0,1fr)로 칸이 컨테이너를 넘지 않게 (넓은 표는 내부에서 가로 스크롤) */
                @media (max-width: 900px) { .stats-grid { grid-template-columns: minmax(0, 1fr); } }
                .stats-summary { margin-bottom: 20px; }
                @media (max-width: 768px) { .stats-layout { padding: 16px; } .stats-layout-title { font-size: 1.35rem; } .stats-summary { margin-bottom: 16px; } }
            `}</style>

            <div className="stats-layout-header">
                <div className="stats-layout-left">
                    <Button variant="neutral" icon="⬅" onClick={onBack}>
                        뒤로
                    </Button>
                    <h1 className="stats-layout-title">{title}</h1>
                </div>
                {actions && <div className="stats-layout-actions">{actions}</div>}
            </div>

            {summary && <div className="stats-summary">{summary}</div>}
            <div className="stats-grid">{children}</div>
        </div>
    );
}

export default StatsLayout;
