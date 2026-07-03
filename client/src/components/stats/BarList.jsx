/**
 * 가로 막대 랭킹 차트. "이름 → 값" 데이터를 순위로 보여준다 (메뉴 순위 등 재사용).
 *
 *   <BarList
 *     data={items}
 *     label={i => i.menu_name}
 *     value={i => i.total_sales}
 *     sublabel={i => `${i.total_qty}잔 · ${i.total_sales}원`}
 *     highlightTop={3}
 *   />
 *
 * @param {Array} data
 * @param {(d)=>React.ReactNode} label     행 이름
 * @param {(d)=>number} value              막대 길이 기준값
 * @param {(d)=>React.ReactNode} [sublabel] 우측 표시값 (없으면 value를 'N원'으로)
 * @param {number} [highlightTop]          상위 N개를 순위 표시 + 강조색
 * @param {number} [max]                   막대 기준 최대값 (없으면 자동)
 */
function BarList({ data = [], label, value, sublabel, highlightTop = 0, max }) {
    const maxVal = max ?? Math.max(...data.map((d) => Number(value(d)) || 0), 1);

    return (
        <div className="barlist">
            <style>{`
                .barlist { display: flex; flex-direction: column; gap: 16px; width: 100%; }
                .barlist-row { display: flex; flex-direction: column; gap: 7px; }
                .barlist-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
                .barlist-label { font-weight: 700; color: var(--text-primary, #333); word-break: keep-all; }
                .barlist-rank { display: inline-block; min-width: 18px; color: var(--text-secondary, #aaa); font-weight: 800; margin-right: 4px; }
                .barlist-value { color: var(--text-secondary, #666); font-size: .9rem; font-weight: 700; white-space: nowrap; text-align: right; }
                .barlist-track { width: 100%; height: 10px; background: var(--border-color, #eee); border-radius: 6px; overflow: hidden; }
                .barlist-fill { height: 100%; border-radius: 6px; transition: width .9s cubic-bezier(.16,1,.3,1); }
            `}</style>

            {data.map((d, i) => {
                const v = Number(value(d)) || 0;
                const hot = i < highlightTop;
                return (
                    <div key={i} className="barlist-row">
                        <div className="barlist-top">
                            <span className="barlist-label">
                                {highlightTop > 0 && <span className="barlist-rank">{i + 1}</span>}
                                {label(d)}
                            </span>
                            <span className="barlist-value">{sublabel ? sublabel(d) : `${v.toLocaleString()}원`}</span>
                        </div>
                        <div className="barlist-track">
                            <div
                                className="barlist-fill"
                                style={{
                                    width: `${(v / maxVal) * 100}%`,
                                    background: hot
                                        ? 'linear-gradient(90deg, #ffb74d, #ff7043)'
                                        : 'linear-gradient(90deg, #64b5f6, #42a5f5)',
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default BarList;
