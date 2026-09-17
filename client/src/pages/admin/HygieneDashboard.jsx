import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { socket, onResync } from '../../utils/socket';
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

/** 결과 상태를 사람이 읽는 말로. 수정 이력에 'ok → fail'처럼 코드가 그대로 나오면 읽기 어렵다. */
const STATUS_NAME = /** @type {Record<string, string>} */ ({ ok: '양호', fail: '미흡', na: '해당 없음' });

/**
 * 기록의 회차 이름. 제출할 때 복사해 둔 이름을 쓴다(회차를 바꿔도 그날 부르던 이름 그대로).
 * 이름을 복사하기 전 기록은 서버가 오전·오후로 채워 두지만, 혹시 비어 있으면 키로 짐작한다.
 * @param {{slot: string, slot_label?: string|null}} c
 */
const slotName = (c) => c.slot_label || (c.slot === 'pm' ? '오후' : c.slot === 'am' ? '오전' : c.slot);

/**
 * 그날 '해야 했던' 회차 목록. 회차 설정은 바뀐 날부터만 적용된다(서버 utils/hygieneSlots.js).
 * 지금 설정으로 과거를 그리면, 회차를 바꾼 순간 지난 기록이 전부 '기록 없음'투성이가 된다.
 *
 * @param {{effective_date: string, slots: {slot_key: string, label: string}[]}[]} plans  날짜 오름차순
 * @param {{slot_key: string, label: string}[]} fallback  설정하기 전의 기본(오전·오후)
 * @param {string} date 'YYYY-MM-DD'
 */
const planFor = (plans, fallback, date) => {
    let plan = fallback;
    for (const p of plans) {
        if (p.effective_date <= date) plan = p.slots;
        else break;
    }
    return plan;
};

/**
 * 그날 표에 그릴 줄. 해야 했던 회차는 기록이 없어도 모두 그린다 — 빼버리면 '무엇을 걸렀는지'가
 * 보이지 않는다. 그 목록에 없는 회차로 낸 기록(그날 중간에 회차를 바꾼 경우)도 감추지 않고 붙인다.
 *
 * @param {{slot_key: string, label: string}[]} plan
 * @param {any[]} dayChecks
 * @returns {{key: string, label: string, check: any}[]}
 */
const dayLines = (plan, dayChecks) => {
    const lines = plan.map((sl) => ({
        key: sl.slot_key,
        label: sl.label,
        check: dayChecks.find((c) => c.slot === sl.slot_key) ?? null,
    }));
    for (const c of dayChecks) {
        if (!plan.some((sl) => sl.slot_key === c.slot)) lines.push({ key: c.slot, label: slotName(c), check: c });
    }
    return lines;
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
 * 어떤 항목의 사진을 지웠는지. 지운 사진 자체는 위 결과 목록에 '삭제됨'으로 그대로 남아 있으므로,
 * 이력에는 어느 항목이었는지만 적어 그쪽을 찾아보게 한다.
 * 항목이 은퇴해 문구를 못 찾은 경우(label이 null)는 세지 않는다.
 */
const removedLabels = (/** @type {any} */ ch) => {
    const labels = (ch.removedPhotos ?? []).map((/** @type {any} */ p) => p.label).filter(Boolean);
    return labels.length > 0 ? [...new Set(labels)].join(', ') : '';
};

/** 시:분. 날짜는 점검 기록 자체가 이미 갖고 있어 이력에는 시각만 적는다. */
const hhmm = (/** @type {string} */ v) => {
    const d = new Date(v);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 빈 글은 '(없음)'으로 보여준다. 아무것도 안 뜨면 지워진 것인지 원래 없던 것인지 알 수 없다. */
const textOr = (/** @type {string|null|undefined} */ v) => (v && v.trim() ? v : '(없음)');

/**
 * 한 번의 수정으로 무엇이 바뀌었는지.
 *
 * 사유·특이사항은 '변경됨'이 아니라 바뀌기 전후의 글을 그대로 보여준다. 상태는 '미흡 → 양호'로
 * 남는데 글만 뭉개면 무엇이 어떻게 고쳐졌는지 알 수 없어 감사 기록으로 쓸모가 없다.
 *
 * 화면(EditLog)과 인쇄 보고서가 같은 것을 쓴다. 따로 만들면 한쪽만 고쳐져 서로 달라진다.
 *
 * @param {{changes: any}} props
 */
function EditChanges({ changes: ch }) {
    if (!ch) return <span className="hyg-edit-what">수정함</span>;
    return (
        <span className="hyg-edit-what">
            {(ch.items ?? []).map((/** @type {any} */ it, /** @type {number} */ j) => {
                const noteChanged = (it.noteFrom ?? '') !== (it.noteTo ?? '');
                return (
                    <span key={j} className="hyg-edit-item">
                        {it.label}
                        {it.from !== it.to && (
                            <b>
                                {' '}
                                {STATUS_NAME[it.from] ?? it.from} → {STATUS_NAME[it.to] ?? it.to}
                            </b>
                        )}
                        {noteChanged && (
                            <span className="hyg-edit-text">
                                사유 <s>{textOr(it.noteFrom)}</s> → {textOr(it.noteTo)}
                            </span>
                        )}
                    </span>
                );
            })}
            {ch.memoChanged && (
                <span className="hyg-edit-item">
                    <span className="hyg-edit-text">
                        특이사항 <s>{textOr(ch.memoFrom)}</s> → {textOr(ch.memoTo)}
                    </span>
                </span>
            )}
            {ch.photos?.added > 0 && <span className="hyg-edit-item">사진 {ch.photos.added}장 추가</span>}
            {ch.photos?.removed > 0 && (
                <span className="hyg-edit-item">
                    사진 {ch.photos.removed}장 삭제
                    {removedLabels(ch) && <span className="hyg-edit-text">{removedLabels(ch)}</span>}
                </span>
            )}
        </span>
    );
}

/**
 * 점검 기록의 수정 이력(화면용). 펼친 점검 상세의 맨 아래에 붙는다.
 * @param {{edits: any[]}} props
 */
function EditLog({ edits }) {
    if (!edits || edits.length === 0) return null;
    return (
        <div className="hyg-edits">
            <p className="hyg-group-name">수정 이력</p>
            {edits.map((/** @type {any} */ e, /** @type {number} */ i) => (
                <div className="hyg-edit" key={i}>
                    <span className="hyg-edit-who">
                        {e.edited_by_name} · {hhmm(e.edited_at)}
                    </span>
                    <EditChanges changes={e.changes} />
                </div>
            ))}
        </div>
    );
}

/**
 * 위생 점검 — 관리자 진입점.
 * 기본 화면은 '점검 기록'이고, 점검 설정(체크리스트·회차·안내 문구)은 한 뎁스 더 들어간다.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 */
function HygieneDashboard({ onBack }) {
    const [view, setView] = useState('records'); // 'records'(기본) | 'items'
    const [checks, setChecks] = useState(/** @type {any[]} */ ([]));
    // 날짜별 회차 이력과, 설정하기 전의 기본 회차. 보고서가 그날 기준으로 줄을 그리는 데 쓴다.
    const [plans, setPlans] = useState(/** @type {any[]} */ ([]));
    const [defaultPlan, setDefaultPlan] = useState(/** @type {{slot_key: string, label: string}[]} */ ([]));
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
            setPlans(res.data.plans ?? []);
            setDefaultPlan(res.data.default_plan ?? []);
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
    // 점검 설정 화면(view === 'items')에서는 듣지 않는다 — 편집 도중에 목록이
    // 갈아엎어지면 드래그·입력이 끊긴다.
    useEffect(() => {
        if (view === 'items') return undefined;
        const refresh = () => void load();
        socket.on('hygiene_updated', refresh);
        // 연결이 끊긴 동안 온 신호는 다시 오지 않는다. 돌아오면 다시 받는다(utils/socket.js).
        const offResync = onResync(refresh);
        return () => {
            offResync();
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

    // 미흡이 나온 '날' 수. 하루 두 번이 되면서 기록 수와 날 수가 갈렸다 —
    // 오전·오후가 모두 미흡이면 기록은 둘이지만 날은 하루다.
    const failDays = new Set(checks.filter((c) => Number(c.fail_count) > 0).map((c) => c.check_date)).size;

    // ---- 인쇄용 보고서에 쓰는 계산 ----
    const store = getStoreInfo();
    // 하루 2회(오전·오후)가 되면서 날짜당 여러 건이다.
    // 예전처럼 Map<날짜, 기록 하나>로 담으면 나중 건이 앞 건을 덮어써 보고서에서 한 건이 사라진다.
    /** @type {Map<string, any[]>} */
    const byDate = new Map();
    for (const c of checks) {
        const list = byDate.get(c.check_date);
        if (list) list.push(c);
        else byDate.set(c.check_date, [c]);
    }

    // 구간의 평일을 모두 늘어놓고 기록 유무를 붙인다.
    // 빠진 날을 감추면 준수 여부를 볼 수 없어 보고서로서 의미가 없다.
    // 다만 휴무일도 '기록 없음'으로 나오므로 보고서에 그 취지를 한 줄 적어둔다.
    /** @type {{date: string, checks: any[]}[]} */
    const rows = [];
    {
        const [fy, fm, fd] = range.from.split('-').map(Number);
        const [ty, tm, td] = range.to.split('-').map(Number);
        const end = new Date(ty, tm - 1, td);
        for (let d = new Date(fy, fm - 1, fd); d <= end; d.setDate(d.getDate() + 1)) {
            const day = d.getDay();
            const key = ymd(d);
            if (day === 0 || day === 6) {
                if (byDate.has(key)) rows.push({ date: key, checks: byDate.get(key) ?? [] }); // 주말 점검은 있으면 싣는다
                continue;
            }
            rows.push({ date: key, checks: byDate.get(key) ?? [] });
        }
    }

    // 수정 이력은 보고서 맨 아래에 따로 싣는다. 일자별 현황 표에 섞으면 '그날 무엇을 점검했나'가
    // 읽히지 않는다. 여러 점검에 흩어져 있으므로 한 줄씩 펴서 시간순으로 늘어놓는다.
    const editRows = checks
        .flatMap((c) =>
            (c.edits ?? []).map((/** @type {any} */ e) => ({
                date: c.check_date,
                slotLabel: slotName(c),
                editor: e.edited_by_name,
                at: e.edited_at,
                changes: e.changes,
            })),
        )
        .sort((a, b) => (a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date)));

    // 일자 칸을 몇 줄에 걸쳐 합칠지. 날짜순 정렬이라 같은 날 줄은 붙어 있다.
    /** @type {Map<string, number>} */
    const editSpan = new Map();
    for (const e of editRows) editSpan.set(e.date, (editSpan.get(e.date) ?? 0) + 1);

    const totalFails = checks.reduce((n, c) => n + Number(c.fail_count), 0);
    // 그날 해야 했던 회차를 모두 채운 날을 센다. 회차 수는 날마다 다를 수 있다(설정을 바꾼 경우).
    const allDone = [...byDate.entries()].filter(([date, list]) =>
        planFor(plans, defaultPlan, date).every((sl) => list.some((c) => c.slot === sl.slot_key)),
    ).length;
    const checkedDays = byDate.size;
    const printedAt = new Date();

    return (
        <StatsLayout
            title="🧼 위생 점검"
            onBack={onBack}
            actions={<ThemeToggle />}
            pageActions={
                <>
                    <Button variant="secondary" icon="⚙️" onClick={() => setView('items')}>
                        점검 설정
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
                .hyg-edits { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border-color, #ddd); }
                .hyg-edit { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; font-size: .84rem; flex-wrap: wrap; }
                .hyg-edit-who { color: var(--text-secondary, #888); white-space: nowrap; font-weight: 700; }
                .hyg-edit-what { display: flex; flex-direction: column; gap: 2px; color: var(--text-primary, #333); }
                .hyg-edit-item { word-break: keep-all; }
                /* 지워진 글은 취소선으로. 무엇이 무엇으로 바뀌었는지 한눈에 읽혀야 한다. */
                .hyg-edit-text { display: block; color: var(--text-secondary, #888); font-size: .82rem; margin-top: 1px; }
                .hyg-edit-text s { color: var(--text-secondary, #aaa); }
                .hyg-slot { font-size: .78rem; font-weight: 700; color: var(--accent); background: var(--accent-bg); padding: 1px 6px; border-radius: 6px; margin-left: 4px; }
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
                    /* 오전·오후 두 줄에 걸쳐 합쳐진 일자 칸은 가운데에 놓아야 두 줄 모두의 것으로 읽힌다.
                       나머지 칸은 윗줄에 맞춰 둔다 — 수정 내용처럼 여러 줄이 되는 칸이 있어서다. */
                    .rp-table td { vertical-align: top; }
                    .rp-table td:first-child { vertical-align: middle; }
                    .rp-none { color: #777; }
                    /* 행이 페이지 경계에서 두 쪽으로 갈라지지 않게, 표 머리글은 매 쪽 반복 */
                    .rp-table tr { break-inside: avoid; }
                    .rp-table thead { display: table-header-group; }
                    .rp-note { margin-top: 10px; font-size: 8.5pt; color: #666; line-height: 1.5; }
                    /* 수정 내용은 화면과 같은 컴포넌트를 쓴다. 다만 색을 변수로 받으므로 다크 모드면
                       흰 글씨가 그대로 인쇄된다. 보고서 안에서는 종이용 색으로 덮어쓴다. */
                    .rp-table .hyg-edit-what { display: block; color: #000; }
                    .rp-table .hyg-edit-item { display: block; }
                    .rp-table .hyg-edit-item + .hyg-edit-item { margin-top: 2px; }
                    .rp-table .hyg-edit-text { display: block; color: #444; font-size: 9pt; margin-top: 0; }
                    .rp-table .hyg-edit-text s { color: #777; }
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
                                    {c.check_date.slice(5)} ({weekdayOf(c.check_date)}){' '}
                                    <span className="hyg-slot">{slotName(c)}</span>
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
                                                                                        removedBy={
                                                                                            ph.status === 'removed'
                                                                                                ? (ph.removed_by_name ??
                                                                                                  '알 수 없음')
                                                                                                : undefined
                                                                                        }
                                                                                        removedAt={ph.removed_at}
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
                                            <EditLog edits={detail.edits} />
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
                        점검 실시 <b>{checkedDays}</b>일 ({checks.length}건)
                    </span>
                    <span>
                        미흡 <b>{totalFails}</b>건 ({failDays}일)
                    </span>
                    <span>
                        모든 회차 완료 <b>{allDone}</b> / {checkedDays}일
                    </span>
                </div>

                <p className="rp-h2">일자별 점검 현황</p>
                <table className="rp-table">
                    <thead>
                        <tr>
                            <th style={{ width: '16%' }}>일자</th>
                            <th style={{ width: '8%' }}>구분</th>
                            <th style={{ width: '14%' }}>점검자</th>
                            <th style={{ width: '12%' }}>점검 시각</th>
                            <th style={{ width: '12%' }}>미흡</th>
                            <th>특이사항</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.flatMap(({ date, checks: dayChecks }) =>
                            dayChecks.length === 0
                                ? [
                                      <tr key={date}>
                                          <td>
                                              {date} ({weekdayOf(date)})
                                          </td>
                                          <td className="rp-none" colSpan={5}>
                                              기록 없음
                                          </td>
                                      </tr>,
                                  ]
                                : // 그날 해야 했던 회차는 한 번만 했어도 모두 그린다(dayLines 참고).
                                  dayLines(planFor(plans, defaultPlan, date), dayChecks).map((line, i, lines) => {
                                      const check = line.check;
                                      return (
                                          <tr key={`${date}-${line.key}`}>
                                              {/* 회차 줄들의 일자 칸을 하나로 합친다. 빈 칸으로 두면
                                                  어느 날에 딸린 줄인지 표에서 읽어내기 어렵다. */}
                                              {i === 0 && (
                                                  <td rowSpan={lines.length}>
                                                      {date} ({weekdayOf(date)})
                                                  </td>
                                              )}
                                              <td className="c">{line.label}</td>
                                              {check ? (
                                                  <>
                                                      <td>{check.checked_by_name}</td>
                                                      <td className="c">{hhmm(check.checked_at)}</td>
                                                      <td className="c">{Number(check.fail_count) || '-'}</td>
                                                      <td>{check.memo || ''}</td>
                                                  </>
                                              ) : (
                                                  <td className="rp-none" colSpan={4}>
                                                      기록 없음
                                                  </td>
                                              )}
                                          </tr>
                                      );
                                  }),
                        )}
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

                {editRows.length > 0 && (
                    <>
                        <p className="rp-h2">점검 기록 수정 이력</p>
                        <table className="rp-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '16%' }}>일자</th>
                                    <th style={{ width: '8%' }}>구분</th>
                                    <th style={{ width: '14%' }}>수정자</th>
                                    <th style={{ width: '12%' }}>수정 시각</th>
                                    <th>수정 내용</th>
                                </tr>
                            </thead>
                            <tbody>
                                {editRows.map((e, i) => (
                                    <tr key={i}>
                                        {/* 일자 칸 병합. 위 표와 같은 방식 — 날짜순으로 정렬돼 있어
                                            같은 날 줄은 반드시 붙어 있다. */}
                                        {(i === 0 || editRows[i - 1].date !== e.date) && (
                                            <td rowSpan={editSpan.get(e.date)}>
                                                {e.date} ({weekdayOf(e.date)})
                                            </td>
                                        )}
                                        <td className="c">{e.slotLabel}</td>
                                        <td>{e.editor}</td>
                                        <td className="c">{hhmm(e.at)}</td>
                                        <td>
                                            <EditChanges changes={e.changes} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                <p className="rp-note">
                    · 점검 항목의 문구는 점검 당시 기록된 그대로이며, 이후 체크리스트가 변경되어도 바뀌지 않습니다.
                    <br />· 평일 중 점검 기록이 없는 날은 &lsquo;기록 없음&rsquo;으로 표시됩니다(휴무일 포함).
                    <br />· 날짜마다 그날 정해져 있던 점검 회차로 표시됩니다. 회차 설정을 바꾼 날부터 새 회차가
                    적용됩니다.
                    {editRows.length > 0 && (
                        <>
                            <br />· 수정 이력은 제출 후 같은 날 안에 고친 내역이며, 취소선은 고치기 전의 내용입니다.
                        </>
                    )}
                </p>
            </div>
        </StatsLayout>
    );
}

export default HygieneDashboard;
