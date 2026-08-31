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
 * @param {import('react').ReactNode} [props.pageActions]  고정 바 아래 흐름에 놓이는 페이지 전용 버튼(선택)
 * @param {import('react').ReactNode} [props.summary]  그리드 위에 놓이는 요약 영역(선택)
 * @param {import('react').ReactNode} props.children
 */
function StatsLayout({ title, onBack, actions, pageActions, summary, children }) {
    return (
        <div className="stats-layout">
            <style>{`
                .stats-layout { padding: 24px; min-height: 100dvh; background: var(--bg-color, #f4f6f8); box-sizing: border-box; transition: background-color .3s ease; }
                /* 내용이 길어져도 뒤로/제목/테마 버튼은 항상 닿을 수 있게 상단 고정.
                   컨테이너 좌우 패딩을 음수 마진으로 상쇄해 배경이 화면 폭을 꽉 채운다. */
                .stats-layout-header {
                    position: sticky; top: 0; z-index: 20;
                    display: flex; align-items: center; justify-content: space-between; gap: 16px;
                    margin: -24px -24px 20px -24px; padding: 12px 24px;
                    background: var(--bg-color, #f4f6f8);
                    border-bottom: 1px solid var(--border-color, rgba(0,0,0,.08));
                    flex-wrap: wrap;
                }
                .stats-layout-left { display: flex; align-items: center; gap: 14px; }
                .stats-layout-title { margin: 0; font-size: 1.8rem; font-weight: 800; color: var(--text-primary, #222); white-space: nowrap; }
                /* 데스크탑 2열 고정: 카드가 좌→우로 채워지고, wide 카드만 한 줄 전체 차지 */
                .stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
                /* 모바일: minmax(0,1fr)로 칸이 컨테이너를 넘지 않게 (넓은 표는 내부에서 가로 스크롤) */
                @media (max-width: 900px) { .stats-grid { grid-template-columns: minmax(0, 1fr); } }
                /* 페이지 전용 버튼은 고정 바에 넣지 않는다. 좁은 화면에서 두 줄로 접히면
                   고정 바가 계속 화면을 잡아먹어 정작 볼 내용이 밀린다. */
                .stats-page-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
                .stats-summary { margin-bottom: 20px; }
                @media (max-width: 768px) {
                    .stats-layout { padding: 16px; }
                    .stats-layout-title { font-size: 1.2rem; }
                    .stats-layout-header { margin: -16px -16px 16px -16px; padding: 10px 16px; gap: 10px; }
                    .stats-summary { margin-bottom: 16px; }
                    .stats-page-actions { gap: 8px; margin-bottom: 16px; }
                }
                /* iPhone SE(375px) 기준: 헤더가 두 줄로 접히면 세로 667px에서 차트가 밀린다.
                   제목을 줄이고 줄바꿈을 막아 한 줄에 유지한다. */
                @media (max-width: 420px) {
                    .stats-layout-header { flex-wrap: nowrap; gap: 8px; }
                    .stats-layout-left { gap: 8px; min-width: 0; }
                    .stats-layout-title { font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; }
                }
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

            {pageActions && <div className="stats-page-actions">{pageActions}</div>}
            {summary && <div className="stats-summary">{summary}</div>}
            <div className="stats-grid">{children}</div>
        </div>
    );
}

export default StatsLayout;
