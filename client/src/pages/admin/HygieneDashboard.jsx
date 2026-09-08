import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { socket } from '../../utils/socket';
import StatsLayout from '../../components/stats/StatsLayout';
import StatCard from '../../components/stats/StatCard';
import Button from '../../components/ui/Button';
import ThemeToggle from '../../components/ThemeToggle';
import HygieneItems from './HygieneItems';
import { useNotification } from '../../hooks/useNotification';
import { getStoreInfo } from '../../utils/storeInfo';
import HygienePhoto from '../../components/HygienePhoto';

const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

/** 'YYYY-MM-DD' (로컬 기준). toISOString은 UTC로 밀려 하루 어긋난다. */
const ymd = (/** @type {Date} */ d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 이번 달(0) / 지난 달(-1)의 1일~말일. 말일은 다음 달 0일로 구한다. */
const monthRange = (/** @type {number} */ offset) => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    // 이번 달이면 아직 오지 않은 날까지 '기록 없음'으로 채우지 않도록 오늘까지만 본다.
    return { from: ymd(first), to: ymd(offset === 0 && last > now ? now : last) };
};

/** 상세 응답에서 그 항목에 붙은 사진만 고른다. 항목이 지워진 과거 기록은 item_id가 없을 수 있다. */
const photosOf = (/** @type {any} */ detail, /** @type {any} */ itemId) =>
    itemId == null ? [] : (detail.photos ?? []).filter((/** @type {any} */ p) => p.item_id === itemId);

/** 서버가 'YYYY-MM-DD' 문자열로 준다. new Date(문자열)은 UTC로 해석돼 하루 밀리므로 직접 쪼갠다. */
const weekdayOf = (/** @type {string} */ ds) => {
    const [y, m, d] = ds.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, d).getDay()];
};

/**
 * 위생 점검 — 관리자 진입점.
 * 기본 화면은 '점검 기록'이고, 체크리스트 편집은 한 뎁스 더 들어간다(원가·순익 분석과 같은 구성).
 *
 * @param {object} props
 * @param {() => void} props.onBack
 */
function HygieneDashboard({ onBack }) {
    const [view, setView] = useState('records'); // 'records'(기본) | 'items'
    const [checks, setChecks] = useState(/** @type {any[]} */ ([]));
    const [range, setRange] = useState(() => ({
        from: ymd(new Date(Date.now() - 29 * 864e5)),
        to: ymd(new Date()),
    }));
    const [loading, setLoading] = useState(true);
    const [openId, setOpenId] = useState(/** @type {number|null} */ (null));
    const [detail, setDetail] = useState(/** @type {any} */ (null));
    const { notify } = useNotification();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/admin/hygiene/checks', {
                ...authCfg(),
                params: { from: range.from, to: range.to },
            });
            setChecks(res.data.checks);
        } catch {
            notify('점검 기록을 불러오지 못했습니다.', { icon: '⚠️' });
        } finally {
            setLoading(false);
        }
    }, [notify, range.from, range.to]);

    useEffect(() => {
        // load는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남 — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    // 직원이 점검을 제출하면 기록에 바로 나타난다.
    // 체크리스트 수정 화면(view === 'items')에서는 듣지 않는다 — 편집 도중에 목록이
    // 갈아엎어지면 드래그·입력이 끊긴다.
    useEffect(() => {
        if (view === 'items') return undefined;
        const refresh = () => void load();
        socket.on('hygiene_updated', refresh);
        return () => {
            socket.off('hygiene_updated', refresh);
        };
    }, [view, load]);

    /** 행을 펼칠 때만 상세를 받아온다. 목록에서 전부 미리 받으면 기록이 쌓일수록 무거워진다. */
    /** @param {number} id */
    const toggle = async (id) => {
        if (openId === id) return setOpenId(null);
        setOpenId(id);
        setDetail(null);
        try {
            const res = await axios.get(`/api/admin/hygiene/checks/${id}`, authCfg());
            setDetail(res.data);
        } catch {
            notify('상세를 불러오지 못했습니다.', { icon: '⚠️' });
        }
    };

    if (view === 'items') {
        return <HygieneItems onBack={() => setView('records')} />;
    }

    const failDays = checks.filter((c) => Number(c.fail_count) > 0).length;

    // ---- 인쇄용 보고서에 쓰는 계산 ----
    const store = getStoreInfo();
    const byDate = new Map(checks.map((c) => [c.check_date, c]));

    // 구간의 평일을 모두 늘어놓고 기록 유무를 붙인다.
    // 빠진 날을 감추면 준수 여부를 볼 수 없어 보고서로서 의미가 없다.
    // 다만 휴무일도 '기록 없음'으로 나오므로 보고서에 그 취지를 한 줄 적어둔다.
    /** @type {{date: string, check: any}[]} */
    const rows = [];
    {
        const [fy, fm, fd] = range.from.split('-').map(Number);
        const [ty, tm, td] = range.to.split('-').map(Number);
        const end = new Date(ty, tm - 1, td);
        for (let d = new Date(fy, fm - 1, fd); d <= end; d.setDate(d.getDate() + 1)) {
            const day = d.getDay();
            const key = ymd(d);
            if (day === 0 || day === 6) {
                if (byDate.has(key)) rows.push({ date: key, check: byDate.get(key) }); // 주말 점검은 있으면 싣는다
                continue;
            }
            rows.push({ date: key, check: byDate.get(key) ?? null });
        }
    }

    const totalFails = checks.reduce((n, c) => n + Number(c.fail_count), 0);
    // '오전 중 완료'가 목표라 12시 전 제출을 따로 센다.
    const beforeNoon = checks.filter((c) => new Date(c.checked_at).getHours() < 12).length;
    const printedAt = new Date();

    return (
        <StatsLayout
            title="🧼 위생 점검"
            onBack={onBack}
            actions={<ThemeToggle />}
            pageActions={
                <>
                    <Button variant="secondary" icon="📋" onClick={() => setView('items')}>
                        체크리스트 수정
                    </Button>
                    <Button variant="secondary" icon="🖨️" onClick={() => window.print()} disabled={loading}>
                        보고서 출력
                    </Button>
                    {/* 보고서는 보통 달 단위로 낸다. 기본 30일 구간이면 달 경계와 어긋나 손으로 맞춰야 한다. */}
                    <Button variant="ghost" size="sm" onClick={() => setRange(monthRange(0))}>
                        이번 달
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRange(monthRange(-1))}>
                        지난 달
                    </Button>
                    <input
                        type="date"
                        className="hyg-date"
                        value={range.from}
                        max={range.to}
                        onChange={(e) => setRange({ ...range, from: e.target.value })}
                    />
                    <span className="hyg-tilde">~</span>
                    <input
                        type="date"
                        className="hyg-date"
                        value={range.to}
                        min={range.from}
                        onChange={(e) => setRange({ ...range, to: e.target.value })}
                    />
                </>
            }
        >
            <style>{`
                .hyg-date { height: 34px; padding: 0 10px; font-family: inherit; font-size: .9rem; border: 1px solid var(--border-color, #ddd); border-radius: 8px; background: var(--card-bg, #fff); color: var(--text-primary, #222); box-sizing: border-box; }
                .hyg-tilde { color: var(--text-secondary, #888); align-self: center; }
                .hyg-check { border-bottom: 1px solid var(--border-color, #eee); }
                .hyg-check:last-child { border-bottom: none; }
                .hyg-check-head { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 4px; background: none; border: none; cursor: pointer; text-align: left; color: var(--text-primary, #222); font-family: inherit; }
                .hyg-check-head:active { background: var(--border-color, #f2f2f2); }
                .hyg-date-cell { font-weight: 800; font-size: .98rem; white-space: nowrap; }
                .hyg-who { color: var(--text-secondary, #888); font-size: .88rem; white-space: nowrap; }
                .hyg-spacer { flex: 1; }
                .hyg-pill { font-size: .78rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
                .hyg-pill.ok { background: var(--success-bg); color: var(--success); }
                .hyg-pill.fail { background: var(--danger-bg); color: var(--danger); }
                .hyg-arrow { color: var(--text-secondary, #aaa); font-size: .8rem; }
                .hyg-detail { padding: 4px 4px 18px; }
                .hyg-group { margin-top: 12px; }
                .hyg-group-name { font-size: .82rem; font-weight: 800; color: var(--text-secondary, #888); margin: 0 0 6px; }
                .hyg-res { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; font-size: .92rem; }
                .hyg-mark { width: 18px; flex-shrink: 0; font-weight: 800; }
                .hyg-mark.ok { color: var(--success); }
                .hyg-mark.fail { color: var(--danger); }
                .hyg-mark.na { color: var(--text-secondary, #aaa); }
                .hyg-note { display: block; color: var(--danger); font-size: .84rem; margin-top: 2px; }
                .hyg-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
                .hyg-memo { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: var(--bg-color, #f7f7f7); color: var(--text-secondary, #777); font-size: .88rem; line-height: 1.6; }
                .hyg-loading { color: var(--text-secondary, #999); font-size: .88rem; padding: 10px 4px; }
                @media (max-width: 620px) {
                    .hyg-check-head { flex-wrap: wrap; gap: 6px 10px; }
                    .hyg-spacer { display: none; }
                    .hyg-who { width: 100%; order: 3; }
                }

                /* ---- 인쇄용 보고서 ----
                   화면에서는 숨겨두고 인쇄할 때만 나온다.
                   색을 변수(--text-primary 등)로 쓰지 않는 이유: 관리자가 다크 모드면 검은 배경이 그대로 인쇄된다.
                   위치를 absolute로 잡으면 첫 페이지에서 잘리므로 반드시 일반 흐름에 둔다. */
                .hyg-report { display: none; }
                @media print {
                    @page { size: A4 portrait; margin: 14mm; }
                    .stats-layout { padding: 0 !important; background: #fff !important; min-height: 0 !important; }
                    /* StatsLayout은 children을 2열 그리드에 넣는다. 그대로 두면 보고서가 페이지 반쪽 폭으로
                       찍히면서 날짜·머리글이 줄줄이 줄바꿈된다(StatCard는 wide 프롭으로 1/-1을 받지만
                       이 div는 그게 없다). 인쇄에서는 그리드를 풀어 한 폭으로 쓴다. */
                    .stats-grid { display: block !important; }
                    .stats-layout-header, .stats-page-actions, .stat-card,
                    .ntf-toast-stack, .ntf-dialog-overlay { display: none !important; }
                    .hyg-report { display: block; color: #000; font-size: 10.5pt; }
                    .rp-head { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 14px; }
                    .rp-store { font-size: 15pt; font-weight: 700; margin: 0 0 2px; }
                    .rp-title { font-size: 11pt; margin: 0; color: #333; }
                    .rp-meta { margin: 6px 0 0; font-size: 9pt; color: #555; }
                    .rp-sum { display: flex; gap: 26px; margin-bottom: 14px; font-size: 10pt; }
                    .rp-sum span { white-space: nowrap; }
                    .rp-sum b { font-size: 13pt; }
                    .rp-h2 { font-size: 11pt; font-weight: 700; margin: 16px 0 6px; }
                    .rp-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
                    .rp-table th, .rp-table td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
                    .rp-table th { background: #eee; font-weight: 700; }
                    .rp-table td.c { text-align: center; }
                    /* 날짜가 좁은 칸에서 세 줄로 접히는 것을 막는다. */
                    .rp-table td:first-child, .rp-table th { white-space: nowrap; }
                    .rp-none { color: #777; }
                    /* 행이 페이지 경계에서 두 쪽으로 갈라지지 않게, 표 머리글은 매 쪽 반복 */
                    .rp-table tr { break-inside: avoid; }
                    .rp-table thead { display: table-header-group; }
                    .rp-note { margin-top: 10px; font-size: 8.5pt; color: #666; line-height: 1.5; }
                }
            `}</style>

            <StatCard
                title="점검 기록"
                icon="🗒️"
                wide
                loading={loading}
                empty={checks.length === 0}
                subtitle={checks.length > 0 ? `${checks.length}건 · 미흡 ${failDays}일` : null}
            >
                {checks.map((c) => {
                    const fail = Number(c.fail_count);
                    const at = new Date(c.checked_at);
                    return (
                        <div className="hyg-check" key={c.id}>
                            <button className="hyg-check-head" onClick={() => toggle(c.id)}>
                                <span className="hyg-date-cell">
                                    {c.check_date.slice(5)} ({weekdayOf(c.check_date)})
                                </span>
                                <span className="hyg-who">
                                    {c.checked_by_name} · {String(at.getHours()).padStart(2, '0')}:
                                    {String(at.getMinutes()).padStart(2, '0')}
                                </span>
                                <span className="hyg-spacer" />
                                <span className={`hyg-pill ${fail > 0 ? 'fail' : 'ok'}`}>
                                    {fail > 0 ? `미흡 ${fail}건` : '이상 없음'}
                                </span>
                                <span className="hyg-arrow">{openId === c.id ? '▲' : '▼'}</span>
                            </button>

                            {openId === c.id && (
                                <div className="hyg-detail">
                                    {!detail ? (
                                        <p className="hyg-loading">불러오는 중…</p>
                                    ) : (
                                        <>
                                            {[
                                                ...new Set(
                                                    detail.results.map((/** @type {any} */ r) => r.item_category),
                                                ),
                                            ].map((cat) => (
                                                <div className="hyg-group" key={String(cat)}>
                                                    <p className="hyg-group-name">{String(cat)}</p>
                                                    {detail.results
                                                        .filter((/** @type {any} */ r) => r.item_category === cat)
                                                        .map((/** @type {any} */ r) => (
                                                            <div className="hyg-res" key={r.id}>
                                                                <span className={`hyg-mark ${r.status}`}>
                                                                    {r.status === 'ok'
                                                                        ? '✓'
                                                                        : r.status === 'fail'
                                                                          ? '✕'
                                                                          : '—'}
                                                                </span>
                                                                <span>
                                                                    {r.item_label}
                                                                    {r.note && (
                                                                        <span className="hyg-note">{r.note}</span>
                                                                    )}
                                                                    {photosOf(detail, r.item_id).length > 0 && (
                                                                        <span className="hyg-photos">
                                                                            {photosOf(detail, r.item_id).map(
                                                                                (/** @type {any} */ ph) => (
                                                                                    <HygienePhoto
                                                                                        key={ph.id}
                                                                                        photoId={ph.id}
                                                                                    />
                                                                                ),
                                                                            )}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        ))}
                                                </div>
                                            ))}
                                            {detail.memo && <div className="hyg-memo">특이사항: {detail.memo}</div>}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </StatCard>

            {/* 인쇄 전용. 화면에는 나오지 않는다(위 .hyg-report { display: none }). */}
            <div className="hyg-report">
                <div className="rp-head">
                    <p className="rp-store">{store ? store.label : 'Baek\u2019s Cafe'}</p>
                    <p className="rp-title">위생 점검 기록 보고서</p>
                    <p className="rp-meta">
                        점검 기간 {range.from} ~ {range.to} · 출력일 {ymd(printedAt)}
                    </p>
                </div>

                <div className="rp-sum">
                    <span>
                        점검 실시 <b>{checks.length}</b>일
                    </span>
                    <span>
                        미흡 <b>{totalFails}</b>건 ({failDays}일)
                    </span>
                    <span>
                        오전 중 완료 <b>{beforeNoon}</b> / {checks.length}일
                    </span>
                </div>

                <p className="rp-h2">일자별 점검 현황</p>
                <table className="rp-table">
                    <thead>
                        <tr>
                            <th style={{ width: '18%' }}>일자</th>
                            <th style={{ width: '16%' }}>점검자</th>
                            <th style={{ width: '12%' }}>점검 시각</th>
                            <th style={{ width: '12%' }}>미흡</th>
                            <th>특이사항</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ date, check }) => (
                            <tr key={date}>
                                <td>
                                    {date} ({weekdayOf(date)})
                                </td>
                                {check ? (
                                    <>
                                        <td>{check.checked_by_name}</td>
                                        <td className="c">
                                            {String(new Date(check.checked_at).getHours()).padStart(2, '0')}:
                                            {String(new Date(check.checked_at).getMinutes()).padStart(2, '0')}
                                        </td>
                                        <td className="c">{Number(check.fail_count) || '-'}</td>
                                        <td>{check.memo || ''}</td>
                                    </>
                                ) : (
                                    <td className="rp-none" colSpan={4}>
                                        기록 없음
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>

                {totalFails > 0 && (
                    <>
                        <p className="rp-h2">미흡 내역 및 조치</p>
                        <table className="rp-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '18%' }}>일자</th>
                                    <th style={{ width: '32%' }}>점검 항목</th>
                                    <th>내용 및 조치</th>
                                </tr>
                            </thead>
                            <tbody>
                                {checks
                                    .slice()
                                    .reverse()
                                    .flatMap((c) =>
                                        c.fails.map((/** @type {any} */ f, /** @type {number} */ i) => (
                                            <tr key={`${c.id}-${i}`}>
                                                <td>{c.check_date}</td>
                                                <td>{f.item_label}</td>
                                                <td>{f.note}</td>
                                            </tr>
                                        )),
                                    )}
                            </tbody>
                        </table>
                    </>
                )}

                <p className="rp-note">
                    · 점검 항목의 문구는 점검 당시 기록된 그대로이며, 이후 체크리스트가 변경되어도 바뀌지 않습니다.
                    <br />· 평일 중 점검 기록이 없는 날은 &lsquo;기록 없음&rsquo;으로 표시됩니다(휴무일 포함).
                </p>
            </div>
        </StatsLayout>
    );
}

export default HygieneDashboard;
