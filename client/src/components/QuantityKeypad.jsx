import { useEffect, useState } from 'react';

/**
 * 숫자를 직접 넣는 키패드. 잔 수와 잔별 추가 샷 수에 함께 쓴다.
 *
 * 캐셔 화면의 −/+ 는 한 번에 하나씩만 움직인다. 1L 음료나 단체 주문처럼 열 잔 넘게
 * 받을 때, 또는 샷을 여러 개 넣을 때 버튼을 반복해 누르는 대신 숫자를 바로 넣게 한다.
 *
 * 수량 숫자를 '한 번' 눌러 연다. 더블클릭이 아닌 이유: 태블릿에서 더블탭이 확대 제스처와
 * 엉키고, 바쁜 캐셔에게 두 번 누르기를 요구하게 된다. 수량 숫자는 원래 아무 반응이 없던
 * 자리라 단일 탭을 그대로 쓸 수 있다.
 *
 * @param {object} props
 * @param {string} props.menuName    무엇의 수량인지 보여준다
 * @param {string} [props.hint]      무엇을 입력하는 중인지(기본: 잔 수)
 * @param {number} props.current     현재 값(입력 없이 확인을 누르면 이 값이 유지된다)
 * @param {(next: number) => void} props.onSubmit
 * @param {() => void} props.onClose
 */
function QuantityKeypad({ menuName, hint = '잔 수를 입력하세요', current, onSubmit, onClose }) {
    // null = 아직 아무 키도 안 눌렀다(현재 잔 수를 그대로 보여주는 중).
    // '' = 눌러서 지웠다(0). 이 둘을 한 값으로 뭉치면, n잔이 있는 상태에서 C를 눌러도
    // 화면이 현재값 그대로라 아무 반응이 없어 보인다.
    const [draft, setDraft] = useState(/** @type {string|null} */ (null));

    /** 숫자 한 자리 입력. 세 자리까지만 받고 앞자리 0은 지운다(007 → 7). */
    const pressDigit = (/** @type {string} */ digit) =>
        setDraft((d) => {
            const base = d ?? ''; // 첫 입력이면 현재값을 두고 새로 쓴다
            return base.length >= 3 ? base : (base + digit).replace(/^0+(?=\d)/, '');
        });

    /** 한 자리 지우기. 아직 안 눌렀으면 현재값을 지우는 것으로 본다. */
    const pressBackspace = () => setDraft((d) => (d === null ? '' : d.slice(0, -1)));

    /** 전부 지우기 → 0. */
    const pressClear = () => setDraft('');

    // 아직 안 눌렀으면 현재값을, 지웠으면 0을 보여준다.
    const untouched = draft === null;
    const shown = untouched ? String(current) : draft === '' ? '0' : draft;
    const next = untouched ? current : Number(draft === '' ? '0' : draft);

    useEffect(() => {
        /** @param {KeyboardEvent} e */
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter') onSubmit(next);
            else if (/^[0-9]$/.test(e.key)) pressDigit(e.key);
            else if (e.key === 'Backspace') pressBackspace();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [next, onSubmit, onClose]);

    return (
        <div className="qk-overlay" onClick={onClose}>
            <style>
                {`
                .qk-overlay { position: fixed; inset: 0; z-index: 11000; background: rgba(0,0,0,.55);
                    display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; }
                .qk-box { background: var(--card-bg, #fff); border-radius: var(--radius-lg); padding: 20px;
                    width: 100%; max-width: 320px; box-sizing: border-box; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
                .qk-menu { font-size: 1rem; font-weight: bold; color: var(--text-primary, #333);
                    text-align: center; word-break: keep-all; margin-bottom: 4px; }
                .qk-hint { font-size: .85rem; color: var(--text-secondary, #888); text-align: center; margin-bottom: 12px; }
                /* 입력값은 크게. 바쁠 때 곁눈질로도 읽혀야 한다. */
                .qk-display { font-size: 2.4rem; font-weight: bold; text-align: center; color: var(--text-primary, #333);
                    background: var(--bg-color, #f4f6f8); border-radius: var(--radius-md); padding: 10px 0; margin-bottom: 14px; }
                /* 아직 아무 키도 안 누른 상태(현재 잔 수를 그냥 비춰 주는 중)는 흐리게 —
                   직접 입력한 값과 눈으로 구분된다. */
                .qk-display.untouched { color: var(--text-secondary, #999); }
                .qk-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
                /* 60px — 터치 최소 권장(44px)보다 넉넉하게. 장갑 낀 손이나 급한 손에도 들어온다. */
                .qk-key { height: 60px; font-size: 1.4rem; font-weight: bold; border-radius: var(--radius-md);
                    border: 1px solid var(--border-color, #ddd); background: var(--card-bg, #fff);
                    color: var(--text-primary, #333); cursor: pointer; }
                .qk-key:active { background: var(--bg-color, #eee); }
                .qk-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
                .qk-btn { height: 52px; font-size: 1.05rem; font-weight: bold; border-radius: var(--radius-md);
                    border: none; cursor: pointer; }
                .qk-cancel { background: var(--border-color, #e0e0e0); color: var(--text-primary, #333); }
                .qk-ok { background: var(--accent); color: #fff; }
                `}
            </style>
            <div
                className="qk-box"
                role="dialog"
                aria-modal="true"
                aria-label={hint}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="qk-menu">{menuName}</div>
                <div className="qk-hint">{hint}</div>
                <div className={`qk-display ${untouched ? 'untouched' : ''}`}>{shown}</div>

                <div className="qk-grid">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                        <button key={d} type="button" className="qk-key" onClick={() => pressDigit(d)}>
                            {d}
                        </button>
                    ))}
                    <button type="button" className="qk-key" onClick={pressClear}>
                        C
                    </button>
                    <button type="button" className="qk-key" onClick={() => pressDigit('0')}>
                        0
                    </button>
                    <button type="button" className="qk-key" onClick={pressBackspace}>
                        ←
                    </button>
                </div>

                <div className="qk-actions">
                    <button type="button" className="qk-btn qk-cancel" onClick={onClose}>
                        취소
                    </button>
                    <button type="button" className="qk-btn qk-ok" onClick={() => onSubmit(next)}>
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
}

export default QuantityKeypad;
