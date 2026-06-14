/**
 * 통계 카드 셸. 제목/아이콘/부제목 + 로딩·빈 상태를 일관되게 처리한다.
 * 본문(children)에 아무 차트나 넣으면 된다.
 *
 *   <StatCard title="메뉴별 인기 순위" icon="🍔" loading={loading} empty={data.length===0}>
 *     <BarList .../>
 *   </StatCard>
 *
 * @param {string} title           카드 제목
 * @param {string} [icon]          제목 앞 이모지
 * @param {React.ReactNode} [subtitle] 우측 작은 부제목
 * @param {boolean} [loading]      true면 스피너 + "불러오는 중"
 * @param {boolean} [empty]        true면 "데이터가 없습니다"
 * @param {boolean} [wide]         true면 그리드 한 줄 전체 차지 (1 / -1)
 */
function StatCard({title, icon, subtitle, loading = false, empty = false, wide = false, children}) {
    return (
        <div className="stat-card" style={wide ? {gridColumn: '1 / -1'} : undefined}>
            <style>{`
                .stat-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, rgba(0,0,0,.06)); border-radius: 16px; padding: 22px 24px; box-shadow: 0 4px 18px rgba(0,0,0,.05); box-sizing: border-box; width: 100%; display: flex; flex-direction: column; transition: box-shadow .2s ease, background-color .3s ease; }
                .stat-card:hover { box-shadow: 0 8px 26px rgba(0,0,0,.09); }
                .stat-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-color, #eee); }
                .stat-card-title { margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text-primary, #222); display: flex; align-items: center; gap: 8px; }
                .stat-card-icon { font-size: 1.3rem; line-height: 1; }
                .stat-card-sub { font-size: .85rem; color: var(--text-secondary, #888); font-weight: 600; white-space: nowrap; }
                .stat-card-body { flex: 1; min-height: 80px; }
                .stat-card-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 44px 0; color: var(--text-secondary, #999); }
                .stat-card-spinner { width: 26px; height: 26px; border: 3px solid var(--border-color, #e5e5e5); border-top-color: #42a5f5; border-radius: 50%; animation: stat-card-spin .8s linear infinite; }
                @keyframes stat-card-spin { to { transform: rotate(360deg); } }
            `}</style>

            <div className="stat-card-head">
                <h2 className="stat-card-title">{icon && <span className="stat-card-icon">{icon}</span>}{title}</h2>
                {subtitle != null && <span className="stat-card-sub">{subtitle}</span>}
            </div>

            <div className="stat-card-body">
                {loading ? (
                    <div className="stat-card-state">
                        <div className="stat-card-spinner"/>
                        <span>불러오는 중...</span></div>
                ) : empty ? (
                    <div className="stat-card-state"><span style={{fontSize: '1.8rem'}}>📭</span><span>데이터가 없습니다</span>
                    </div>
                ) : children}
            </div>
        </div>
    );
}

export default StatCard;
