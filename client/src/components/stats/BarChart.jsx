/**
 * 막대 추이 차트. "구간(시간/요일 등) → 값"을 보여준다 (시간대 매출 등 재사용).
 * - PC: 세로 막대 (가로 스크롤)
 * - 모바일(≤768px): 가로 막대 리스트로 자동 전환 (좁은 화면 가독성)
 * 큰 금액은 'N만'으로 축약 표시.
 *
 *   <BarChart data={timeStats} label={t => `${t.hour}시`} value={t => t.total_sales} color="#4caf50" />
 *
 * @param {object} props
 * @param {any[]} [props.data]
 * @param {(d:any)=>import('react').ReactNode} props.label   라벨 (구간명)
 * @param {(d:any)=>number} props.value                      막대 크기 기준값
 * @param {string} [props.color]                             막대 색
 * @param {number} [props.height]                            PC 세로 차트 높이(px)
 */
function BarChart({ data = [], label, value, color = '#42a5f5', height = 240 }) {
    const maxVal = Math.max(...data.map((d) => Number(value(d)) || 0), 1);
    const fmt = (v) => (v >= 10000 ? `${(v / 10000).toFixed(1)}만` : v.toLocaleString());

    return (
        <div className="barchart">
            <style>{`
                /* ===== PC: 세로 막대 ===== */
                .barchart-vertical { width: 100%; overflow-x: auto; padding-bottom: 6px; }
                .barchart-cols { display: flex; align-items: stretch; gap: 12px; min-width: min-content; height: ${height}px; }
                .barchart-col { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; min-width: 40px; height: 100%; }
                .barchart-val { font-size: .72rem; font-weight: 800; color: var(--text-secondary, #777); white-space: nowrap; }
                .barchart-wrap { flex: 1; width: 100%; min-height: 0; display: flex; align-items: flex-end; justify-content: center; }
                .barchart-bar { width: 62%; max-width: 34px; min-height: 3px; border-radius: 7px 7px 0 0; transition: height .7s cubic-bezier(.16,1,.3,1); }
                .barchart-label { font-size: .78rem; font-weight: 700; color: var(--text-secondary, #888); white-space: nowrap; }

                /* ===== 모바일: 가로 막대 리스트 ===== */
                .barchart-horizontal { display: none; flex-direction: column; gap: 14px; width: 100%; }
                .bch-row { display: flex; flex-direction: column; gap: 7px; }
                .bch-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
                .bch-label { font-weight: 700; color: var(--text-primary, #333); }
                .bch-value { color: var(--text-secondary, #666); font-size: .9rem; font-weight: 700; white-space: nowrap; }
                .bch-track { width: 100%; height: 10px; background: var(--border-color, #eee); border-radius: 6px; overflow: hidden; }
                .bch-fill { height: 100%; border-radius: 6px; transition: width .9s cubic-bezier(.16,1,.3,1); }

                @media (max-width: 768px) {
                    .barchart-vertical { display: none; }
                    .barchart-horizontal { display: flex; }
                }
            `}</style>

            {/* PC: 세로 막대 */}
            <div className="barchart-vertical">
                <div className="barchart-cols">
                    {data.map((d, i) => {
                        const v = Number(value(d)) || 0;
                        return (
                            <div key={i} className="barchart-col" title={`${v.toLocaleString()}원`}>
                                <div className="barchart-val">{fmt(v)}</div>
                                <div className="barchart-wrap">
                                    <div
                                        className="barchart-bar"
                                        style={{
                                            height: `${(v / maxVal) * 100}%`,
                                            background: `linear-gradient(180deg, ${color}, ${color}bb)`,
                                        }}
                                    />
                                </div>
                                <div className="barchart-label">{label(d)}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 모바일: 가로 막대 */}
            <div className="barchart-horizontal">
                {data.map((d, i) => {
                    const v = Number(value(d)) || 0;
                    return (
                        <div key={i} className="bch-row">
                            <div className="bch-top">
                                <span className="bch-label">{label(d)}</span>
                                <span className="bch-value">{v.toLocaleString()}원</span>
                            </div>
                            <div className="bch-track">
                                <div
                                    className="bch-fill"
                                    style={{
                                        width: `${(v / maxVal) * 100}%`,
                                        background: `linear-gradient(90deg, ${color}, ${color}bb)`,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default BarChart;
