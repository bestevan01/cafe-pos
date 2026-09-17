import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import StatCard from './stats/StatCard';
import Button from './ui/Button';
import { useNotification } from '../hooks/useNotification';

const authCfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

/**
 * 위생 점검 안내 문구 — 매장별 지침을 직원 점검 화면 위쪽에 보여준다.
 *
 * 누가 점검할지 같은 지침은 매장마다 다르고(코드는 매장끼리 공유한다), 앱은 누가 시트 기입·
 * 음료 제조를 맡았는지 모르므로 막을 수 없다. 그래서 규칙으로 강제하지 않고 문구로 안내한다.
 */
function HygieneGuideEditor() {
    const { notify } = useNotification();
    const [value, setValue] = useState('');
    const [saved, setSaved] = useState('');
    const [meta, setMeta] = useState(/** @type {{updated_at?: string, updated_by_name?: string}|null} */ (null));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await axios.get('/api/admin/hygiene/guide', authCfg());
            setValue(res.data.value ?? '');
            setSaved(res.data.value ?? '');
            setMeta(res.data.value ? res.data : null);
        } catch {
            notify('안내 문구를 불러오지 못했습니다.', { icon: '⚠️', dedupeKey: 'load-hygiene-guide' });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    const save = async () => {
        setSaving(true);
        try {
            await axios.put('/api/admin/hygiene/guide', { value }, authCfg());
            notify(value.trim() ? '안내 문구를 저장했습니다.' : '안내 문구를 지웠습니다.', { icon: '✅' });
            await load();
        } catch (/** @type {any} */ err) {
            notify(err?.response?.data?.message || '안내 문구를 저장하지 못했습니다.', { icon: '⚠️' });
        } finally {
            setSaving(false);
        }
    };

    const dirty = value.trim() !== saved.trim();

    return (
        <StatCard
            title="점검 안내 문구"
            icon="📢"
            wide
            loading={loading}
            subtitle={meta?.updated_by_name ? `${meta.updated_by_name} 수정` : null}
        >
            <style>{`
                .hg-hint { font-size: .78rem; color: var(--text-secondary, #999); margin: 0 0 10px; line-height: 1.6; word-break: keep-all; }
                .hg-text { width: 100%; min-height: 96px; padding: 10px; box-sizing: border-box; border: 1px solid var(--border-color, #ddd); border-radius: 10px; background: var(--bg-color, #fff); color: var(--text-primary, #222); font-family: inherit; font-size: .92rem; line-height: 1.6; resize: vertical; }
                .hg-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; }
                .hg-count { font-size: .76rem; color: var(--text-secondary, #aaa); }
            `}</style>
            <p className="hg-hint">
                직원의 위생 점검 화면 위쪽에 그대로 보입니다. 이 매장에만 적용됩니다. 예) 점검 시간대에 3명 이상
                근무하면 시트 기입자와 음료 제조자를 뺀 분이 점검해주세요. 비워 두면 표시하지 않습니다.
            </p>
            <textarea
                className="hg-text"
                value={value}
                maxLength={1000}
                onChange={(e) => setValue(e.target.value)}
                placeholder="매장 점검 지침을 적어주세요"
            />
            <div className="hg-foot">
                <span className="hg-count">{value.length} / 1000</span>
                <Button onClick={save} disabled={saving || !dirty}>
                    {saving ? '저장 중…' : '저장'}
                </Button>
            </div>
        </StatCard>
    );
}

export default HygieneGuideEditor;
