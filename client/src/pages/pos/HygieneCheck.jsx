import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Button from '../../components/ui/Button';
import { useNotification } from '../../hooks/useNotification';
import HygienePhoto from '../../components/HygienePhoto';
import { uploadHygienePhoto, deleteHygienePhoto } from '../../utils/hygienePhotos';

const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const STATUS = [
    { key: 'ok', label: '정상' },
    { key: 'fail', label: '미흡' },
    { key: 'na', label: '해당 없음' },
];

/** 점검 칸 이름. 어느 칸인지는 서버가 자기 시계로 정하고, 여기서는 보여주기만 한다. */
const SLOT_NAME = /** @type {Record<string, string>} */ ({ am: '오전', pm: '오후' });

/**
 * 직원용 위생 점검 화면. 운영 지침에 따라 하루 두 번(오전·오후) 하고, 같은 칸이면 다시 열어 고칠 수 있다.
 *
 * 제출한 문구는 서버가 DB의 항목에서 다시 읽어 기록에 복사한다(클라이언트가 보낸 문구는 쓰지 않는다).
 * 그래서 나중에 관리자가 항목을 고쳐도 이미 낸 기록은 그대로 남는다.
 *
 * @param {object} props
 * @param {() => void} props.onClose
 */
function HygieneCheck({ onClose }) {
    const [items, setItems] = useState(/** @type {any[]} */ ([]));
    const [answers, setAnswers] = useState(/** @type {Record<number, {status: string, note: string}>} */ ({}));
    const [memo, setMemo] = useState('');
    const [existing, setExisting] = useState(/** @type {any} */ (null));
    // 오늘의 두 칸(오전·오후) 기록. 어느 칸이 비었는지, 오전을 누가 했는지 판단하는 데 쓴다.
    const [slots, setSlots] = useState(/** @type {{am: any, pm: any}} */ ({ am: null, pm: null }));
    // 지금 채우는 칸. 서버가 자기 시계로 정해 내려준다.
    // 직원이 고르게 하지 않는 이유: 고를 수 있으면 칸과 실제 제출 시각이 어긋난다
    // (실제로 '오전 · 16:29' 같은 기록이 남았다). 기기 시계가 틀어져 있어도 서버 기준으로 일관된다.
    const [slot, setSlot] = useState('am');
    // 항목 id → 사진 id 목록. 제출할 때 결과에 함께 실어 보낸다.
    const [photos, setPhotos] = useState(/** @type {Record<number, number[]>} */ ({}));
    const [uploading, setUploading] = useState(/** @type {number|null} */ (null));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { notify } = useNotification();

    // 다른 칸을 누가 점검했는지. 같은 사람이 두 칸을 다 하지 않도록 안내하는 데 쓴다.
    // 막지 않고 알리기만 한다 — 혼자 근무하는 시간대가 있을 수 있고, 시스템은 지금 몇 명이
    // 일하는지 모른다. 막으면 점검 자체를 못 하는 상황이 생긴다.
    const otherSlot = slot === 'am' ? 'pm' : 'am';
    const otherSlotLabel = SLOT_NAME[otherSlot];
    const otherChecker = slots[otherSlot]?.checked_by_name ?? null;

    const load = useCallback(async () => {
        try {
            const [itemRes, todayRes] = await Promise.all([
                axios.get('/api/hygiene/items', authCfg()),
                axios.get('/api/hygiene/today', authCfg()),
            ]);
            setItems(itemRes.data);

            const bySlot = todayRes.data.slots ?? { am: null, pm: null };
            const cur = todayRes.data.current_slot ?? 'am';
            setSlots(bySlot);
            setSlot(cur);
            const today = bySlot[cur];
            setExisting(today);
            if (today) {
                // 이미 낸 기록이 있으면 그 값으로 채워 '수정' 모드로 연다.
                /** @type {Record<number, {status: string, note: string}>} */
                const prev = {};
                for (const r of today.results) {
                    if (r.item_id != null) prev[r.item_id] = { status: r.status, note: r.note ?? '' };
                }
                setAnswers(prev);
                setMemo(today.memo ?? '');
                /** @type {Record<number, number[]>} */
                const byItem = {};
                for (const ph of today.photos ?? []) {
                    if (ph.item_id != null) (byItem[ph.item_id] ??= []).push(ph.id);
                }
                setPhotos(byItem);
            } else {
                // 빈 칸으로 바꿨을 때 앞 칸의 답이 남아 있으면 안 된다.
                setAnswers({});
                setMemo('');
                setPhotos({});
            }
        } catch {
            notify('점검 항목을 불러오지 못했습니다.', { icon: '⚠️' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // load는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남 — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    /** @param {number} id @param {string} status */
    const pick = (id, status) => {
        // 사유 입력칸은 미흡일 때만 보인다. 다른 상태로 바꾸면 적어둔 사유도 함께 비운다 —
        // 남겨두면 화면에 보이지 않는 채로 저장돼 관리자 기록에만 남는다.
        // 서버도 같은 규칙으로 한 번 더 거르지만, 여기서 비워야 수정 이력의 전후 비교가
        // 실제로 저장되는 값과 맞는다.
        setAnswers((a) => ({ ...a, [id]: { status, note: status === 'fail' ? (a[id]?.note ?? '') : '' } }));
    };

    /** @param {number} id @param {string} note */
    const setNote = (id, note) => {
        setAnswers((a) => ({ ...a, [id]: { status: a[id]?.status ?? 'ok', note } }));
    };

    /** @param {number} itemId @param {File|undefined} file */
    const addPhoto = async (itemId, file) => {
        if (!file) return;
        setUploading(itemId);
        try {
            const photoId = await uploadHygienePhoto(file, itemId);
            setPhotos((p) => ({ ...p, [itemId]: [...(p[itemId] ?? []), photoId] }));
        } catch (/** @type {any} */ err) {
            // CORS나 네트워크로 막히면 fetch가 예외로 끝나 응답이 없다.
            notify(err?.response?.data?.message || '사진을 올리지 못했습니다.', { icon: '⚠️' });
        } finally {
            setUploading(null);
        }
    };

    /** @param {number} itemId @param {number} photoId */
    const removePhoto = async (itemId, photoId) => {
        try {
            await deleteHygienePhoto(photoId);
            setPhotos((p) => ({ ...p, [itemId]: (p[itemId] ?? []).filter((id) => id !== photoId) }));
        } catch {
            notify('사진을 지우지 못했습니다.', { icon: '⚠️' });
        }
    };

    const done = items.filter((i) => answers[i.id]?.status).length;
    const failCount = items.filter((i) => answers[i.id]?.status === 'fail').length;
    const allAnswered = done === items.length && items.length > 0;

    const submit = async () => {
        // 서버도 같은 검증을 하지만, 여기서 먼저 막아야 어디가 비었는지 바로 알 수 있다.
        const missing = items.find((i) => !answers[i.id]?.status);
        if (missing) return notify(`"${missing.label}" 항목이 남았습니다.`, { icon: '⚠️' });
        const noReason = items.find((i) => answers[i.id]?.status === 'fail' && !answers[i.id]?.note.trim());
        if (noReason) return notify(`"${noReason.label}"의 미흡 사유를 적어주세요.`, { icon: '⚠️' });

        setSaving(true);
        const body = {
            memo,
            results: items.map((i) => ({
                item_id: i.id,
                status: answers[i.id].status,
                note: answers[i.id].note,
                photo_ids: photos[i.id] ?? [],
            })),
        };
        try {
            if (existing) await axios.put(`/api/hygiene/checks/${existing.id}`, body, authCfg());
            else await axios.post('/api/hygiene/checks', body, authCfg());
            notify(existing ? '점검 기록을 수정했습니다.' : `${SLOT_NAME[slot]} 위생 점검을 제출했습니다.`, {
                icon: '✅',
            });
            onClose();
        } catch (/** @type {any} */ err) {
            // 다른 사람이 먼저 제출한 경우. 덮어쓰지 않고 그 기록을 불러와 수정 모드로 바꾼다.
            if (err?.response?.status === 409) {
                notify('다른 직원이 먼저 제출했습니다. 그 기록을 불러옵니다.', { icon: '⚠️' });
                setLoading(true);
                await load();
            } else {
                notify(err?.response?.data?.message || '제출에 실패했습니다.', { icon: '⚠️' });
            }
        } finally {
            setSaving(false);
        }
    };

    /** @type {string[]} */
    const categories = [...new Set(items.map((i) => i.category))];

    return (
        <div className="hc-overlay">
            <style>{`
                .hc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(3px); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; }
                /* 항목이 많아 카드 전체가 길어진다. 머리·바닥은 붙여두고 목록만 스크롤시킨다. */
                .hc-card { background: var(--card-bg, #fff); border-radius: var(--radius-lg); width: 100%; max-width: 560px; max-height: 100%; display: flex; flex-direction: column; min-height: 0; box-shadow: 0 12px 40px rgba(0,0,0,.3); box-sizing: border-box; }
                .hc-head { padding: 18px 20px 14px; border-bottom: 1px solid var(--border-color, #eee); }
                .hc-title { margin: 0 0 6px; font-size: 1.25rem; font-weight: 800; color: var(--text-primary, #222); }
                .hc-sub { margin: 0; font-size: .86rem; color: var(--text-secondary, #888); line-height: 1.5; }
                .hc-slotnow { display: flex; align-items: center; gap: 8px; margin: 10px 0 8px; flex-wrap: wrap; }
                .hc-slotbadge { font-size: .95rem; font-weight: 700; color: var(--accent);
                    background: var(--accent-bg); padding: 5px 12px; border-radius: 999px; }
                .hc-otherdone { font-size: .82rem; color: var(--success); }
                .hc-otherwait { font-size: .82rem; color: var(--text-secondary, #999); }
                .hc-warn { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px;
                    background: var(--warning-bg); color: #ef6c00; font-size: .84rem; line-height: 1.5; word-break: keep-all; }
                [data-theme='dark'] .hc-warn { background: rgba(239, 108, 0, .18); color: #ffb74d; }
                .hc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 20px 12px; }
                .hc-group { margin-top: 16px; }
                .hc-group-name { font-size: .8rem; font-weight: 800; color: var(--text-secondary, #999); margin: 0 0 8px; }
                .hc-item { padding: 10px 0; border-bottom: 1px solid var(--border-color, #f0f0f0); }
                .hc-item:last-child { border-bottom: none; }
                .hc-label { font-size: .95rem; color: var(--text-primary, #333); margin: 0 0 8px; line-height: 1.5; word-break: keep-all; }
                .hc-choices { display: flex; gap: 6px; }
                /* 근무 중 손가락으로 누르는 화면이라 최소 44px 높이를 준다. */
                .hc-choice { flex: 1; min-height: 44px; border: 1px solid var(--border-color, #ddd); border-radius: 10px; background: var(--bg-color, #fafafa); color: var(--text-secondary, #888); font-family: inherit; font-size: .9rem; font-weight: 700; cursor: pointer; }
                .hc-choice.on.ok { background: var(--success-bg); border-color: var(--success); color: var(--success); }
                .hc-choice.on.fail { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }
                .hc-choice.on.na { background: var(--border-color, #eee); border-color: var(--text-secondary, #bbb); color: var(--text-primary, #555); }
                .hc-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
                /* 파일 입력은 숨기고 라벨을 버튼처럼 쓴다. accept/capture 덕에 폰에서 카메라가 바로 열린다. */
                .hc-add-photo { width: 84px; height: 84px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px dashed var(--border-color, #ccc); border-radius: 10px; background: var(--bg-color, #fafafa); color: var(--text-secondary, #888); font-size: .72rem; cursor: pointer; }
                .hc-add-photo input { display: none; }
                .hc-add-photo .plus { font-size: 1.3rem; line-height: 1; }
                .hc-add-photo.busy { opacity: .5; cursor: default; }
                .hc-note { width: 100%; margin-top: 8px; min-height: 44px; padding: 10px; border: 1px solid var(--danger); border-radius: 10px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; font-size: .9rem; box-sizing: border-box; resize: vertical; }
                .hc-memo { width: 100%; min-height: 60px; margin-top: 8px; padding: 10px; border: 1px solid var(--border-color, #ddd); border-radius: 10px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; font-size: .9rem; box-sizing: border-box; resize: vertical; }
                .hc-foot { padding: 14px 20px; border-top: 1px solid var(--border-color, #eee); display: flex; align-items: center; gap: 10px; }
                .hc-progress { flex: 1; font-size: .88rem; font-weight: 700; color: var(--text-secondary, #888); }
                .hc-progress .warn { color: var(--danger); }
                @media (max-width: 480px) {
                    .hc-overlay { padding: 0; }
                    .hc-card { max-width: 100%; height: 100%; max-height: 100%; border-radius: 0; }
                }
            `}</style>

            <div className="hc-card">
                <div className="hc-head">
                    <h2 className="hc-title">🧼 위생 점검</h2>
                    {!loading && (
                        <div className="hc-slotnow">
                            <span className="hc-slotbadge">{SLOT_NAME[slot]} 점검</span>
                            {slots[otherSlot] ? (
                                <span className="hc-otherdone">{otherSlotLabel} 완료 ✓</span>
                            ) : (
                                <span className="hc-otherwait">{otherSlotLabel} 미완료</span>
                            )}
                        </div>
                    )}
                    <p className="hc-sub">
                        {loading
                            ? '불러오는 중…'
                            : existing
                              ? `${existing.checked_by_name}님이 제출했습니다. 고쳐서 다시 저장할 수 있습니다.`
                              : '매장을 둘러보고 항목마다 상태를 골라주세요.'}
                    </p>
                    {!loading && !existing && otherChecker ? (
                        <p className="hc-warn">
                            ⚠️ {otherSlotLabel} 점검을 {otherChecker}님이 하셨습니다. 일을 고르게 나누기 위해 가급적
                            다른 분이 진행해주세요.
                        </p>
                    ) : null}
                </div>

                <div className="hc-body">
                    {categories.map((cat) => (
                        <div className="hc-group" key={cat}>
                            <p className="hc-group-name">{cat}</p>
                            {items
                                .filter((i) => i.category === cat)
                                .map((item) => {
                                    const a = answers[item.id];
                                    return (
                                        <div className="hc-item" key={item.id}>
                                            <p className="hc-label">{item.label}</p>
                                            <div className="hc-choices">
                                                {STATUS.map((s) => (
                                                    <button
                                                        key={s.key}
                                                        className={`hc-choice ${s.key} ${a?.status === s.key ? 'on' : ''}`}
                                                        onClick={() => pick(item.id, s.key)}
                                                    >
                                                        {s.label}
                                                    </button>
                                                ))}
                                            </div>
                                            {a?.status === 'fail' && (
                                                <textarea
                                                    className="hc-note"
                                                    placeholder="무엇이 문제였고 어떻게 조치했는지 적어주세요 (필수)"
                                                    value={a.note}
                                                    onChange={(e) => setNote(item.id, e.target.value)}
                                                />
                                            )}
                                            {/* 이미 붙은 사진은 상태와 무관하게 보여준다. 미흡일 때만 보이게 하면
                                                양호로 바꾼 순간 사진이 화면에서 사라지는데, 기록에는 그대로 남아
                                                관리자 화면에만 뜬다. 사진은 조용히 지우지 않는 것이 원칙이라
                                                (지워도 삭제 기록으로 남긴다) 감추는 대신 보이게 두고 직접 지우게 한다.
                                                새로 붙이는 것은 미흡일 때만 — 사진은 문제를 남기기 위한 것이다. */}
                                            {(a?.status === 'fail' || (photos[item.id] ?? []).length > 0) && (
                                                <div className="hc-photos">
                                                    {(photos[item.id] ?? []).map((pid) => (
                                                        <HygienePhoto
                                                            key={pid}
                                                            photoId={pid}
                                                            onRemove={() => removePhoto(item.id, pid)}
                                                        />
                                                    ))}
                                                    {a?.status === 'fail' && (
                                                        <label
                                                            className={`hc-add-photo ${uploading === item.id ? 'busy' : ''}`}
                                                        >
                                                            <span className="plus">
                                                                {uploading === item.id ? '⏳' : '＋'}
                                                            </span>
                                                            {uploading === item.id ? '올리는 중' : '사진'}
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                capture="environment"
                                                                disabled={uploading !== null}
                                                                onChange={(e) => {
                                                                    addPhoto(item.id, e.target.files?.[0]);
                                                                    e.target.value = ''; // 같은 파일을 다시 골라도 change가 뜨도록
                                                                }}
                                                            />
                                                        </label>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    ))}

                    {!loading && items.length === 0 && (
                        <p className="hc-sub" style={{ padding: '24px 0' }}>
                            점검 항목이 아직 없습니다. 관리자에게 문의해주세요.
                        </p>
                    )}

                    {items.length > 0 && (
                        <div className="hc-group">
                            <p className="hc-group-name">특이사항 (선택)</p>
                            <textarea
                                className="hc-memo"
                                placeholder="점검 중 알아둘 점이 있으면 적어주세요"
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                            />
                        </div>
                    )}
                </div>

                <div className="hc-foot">
                    <span className="hc-progress">
                        {done} / {items.length}
                        {failCount > 0 && <span className="warn"> · 미흡 {failCount}건</span>}
                    </span>
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                        닫기
                    </Button>
                    <Button onClick={submit} disabled={saving || loading || !allAnswered}>
                        {saving ? '저장 중…' : existing ? '수정 저장' : '제출'}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export default HygieneCheck;
