/**
 * 통계 페이지 상단 요약 타일. 차트를 읽지 않고도 총계를 먼저 파악하게 한다.
 *
 *   <SummaryTiles loading={loading} items={[{ label: '총 매출', value: '914만원' }]} />
 *
 * @param {object} props
 * @param {{label: string, value: string, hint?: string}[]} props.items
 * @param {boolean} [props.loading]
 */
function SummaryTiles({ items, loading = false }) {
    return (
        <div className="summary-tiles">
            <style>{`
                /* PC 4열 → iPhone SE(375px)에서는 2×2. 4열을 유지하면 '2,824건' 같은 값이 줄바꿈된다. */
                .summary-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
                @media (max-width: 620px) { .summary-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }

                .summary-tile {
                    background: var(--card-bg, #fff);
                    border: 1px solid var(--border-color, rgba(0,0,0,.06));
                    border-radius: 14px; padding: 14px 16px; min-width: 0;
                    box-shadow: 0 4px 18px rgba(0,0,0,.05);
                    transition: background-color .3s ease;
                }
                .summary-label {
                    font-size: .78rem; font-weight: 700; color: var(--text-secondary, #888);
                    margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .summary-value {
                    font-size: 1.35rem; font-weight: 800; color: var(--text-primary, #222);
                    line-height: 1.2; font-variant-numeric: tabular-nums;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .summary-hint { font-size: .72rem; color: var(--text-secondary, #999); margin-top: 4px; }
                .summary-skeleton {
                    height: 1.35rem; border-radius: 6px;
                    background: var(--border-color, #eee); opacity: .6;
                }
                @media (max-width: 768px) {
                    .summary-tile { padding: 12px 13px; border-radius: 12px; }
                    .summary-value { font-size: 1.15rem; }
                }
            `}</style>

            {items.map((it) => (
                <div key={it.label} className="summary-tile">
                    <div className="summary-label">{it.label}</div>
                    {loading ? <div className="summary-skeleton" /> : <div className="summary-value">{it.value}</div>}
                    {!loading && it.hint && <div className="summary-hint">{it.hint}</div>}
                </div>
            ))}
        </div>
    );
}

export default SummaryTiles;
