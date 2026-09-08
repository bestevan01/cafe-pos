import { useState, useEffect, useRef, useCallback } from 'react';
import { getHygienePhotoUrl } from '../utils/hygienePhotos';

const MAX_SCALE = 6;

/**
 * 저장된 위생 점검 사진 한 장. 누르면 크게 볼 수 있고, 확대 화면에서 확대·이동이 된다.
 *
 * 서명 URL은 만료가 짧아서(10분) 미리 받아두지 않고 이 컴포넌트가 필요할 때 받아온다.
 * 확대 화면은 같은 URL을 그대로 쓴다 — 썸네일이 이미 원본을 받아 캐시에 있어서 새 요청이 나가지 않는다.
 *
 * 보관 기간(2년)이 지난 사진은 R2에서 이미 지워졌으므로 서버가 URL을 주지 않는다 —
 * 깨진 이미지 대신 만료 안내를 보여준다.
 *
 * @param {object} props
 * @param {number} props.photoId
 * @param {() => void} [props.onRemove] 있으면 삭제 버튼이 나온다
 */
function HygienePhoto({ photoId, onRemove }) {
    const [state, setState] = useState(/** @type {'loading'|'ready'|'expired'|'error'} */ ('loading'));
    const [url, setUrl] = useState('');
    const [zoomed, setZoomed] = useState(false);

    const boxRef = useRef(/** @type {HTMLDivElement|null} */ (null));
    const imgRef = useRef(/** @type {HTMLImageElement|null} */ (null));
    // 변환값을 state가 아니라 ref에 둔다. 제스처 중에는 초당 수십 번 바뀌는데
    // 매번 리렌더하면 눈에 띄게 끊긴다. DOM에 직접 반영하는 편이 부드럽다.
    const tf = useRef({ scale: 1, x: 0, y: 0 });
    const pointers = useRef(/** @type {Map<number, {x: number, y: number}>} */ (new Map()));
    const pinch = useRef(/** @type {{dist: number, scale: number}|null} */ (null));
    const moved = useRef(false);

    useEffect(() => {
        let alive = true;
        getHygienePhotoUrl(photoId)
            .then((u) => {
                if (!alive) return;
                if (u) {
                    setUrl(u);
                    setState('ready');
                } else {
                    setState('expired');
                }
            })
            .catch(() => alive && setState('error'));
        return () => {
            alive = false;
        };
    }, [photoId]);

    const apply = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        const { scale, x, y } = tf.current;
        el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        el.style.cursor = scale > 1 ? 'grab' : 'zoom-out';
    }, []);

    /** 화면 밖으로 밀려나 사진을 놓치는 일이 없도록, 이동 범위를 확대된 크기 안으로 가둔다. */
    const clamp = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const baseW = r.width / tf.current.scale;
        const baseH = r.height / tf.current.scale;
        const maxX = Math.max(0, (baseW * tf.current.scale - baseW) / 2);
        const maxY = Math.max(0, (baseH * tf.current.scale - baseH) / 2);
        tf.current.x = Math.min(maxX, Math.max(-maxX, tf.current.x));
        tf.current.y = Math.min(maxY, Math.max(-maxY, tf.current.y));
    }, []);

    // 기준점(cx, cy)을 붙잡은 채 배율만 바꾼다. 그래야 손가락·커서가 가리키던 지점이 그대로 있다.
    // JSDoc은 useCallback을 감싼 변수가 아니라 안쪽 화살표 함수에 붙여야 매개변수 타입이 잡힌다
    // (변수에 붙이면 implicit any가 된다). NotificationProvider와 같은 방식.
    const zoomAt = useCallback(
        /**
         * @param {number} next  목표 배율
         * @param {number} cx    화면 기준 기준점 x
         * @param {number} cy    화면 기준 기준점 y
         */
        (next, cx, cy) => {
            const box = boxRef.current;
            if (!box) return;
            const r = box.getBoundingClientRect();
            const ox = cx - (r.left + r.width / 2);
            const oy = cy - (r.top + r.height / 2);
            const prev = tf.current.scale;
            const scale = Math.min(MAX_SCALE, Math.max(1, next));
            tf.current.x = ox - (ox - tf.current.x) * (scale / prev);
            tf.current.y = oy - (oy - tf.current.y) * (scale / prev);
            tf.current.scale = scale;
            if (scale === 1) tf.current = { scale: 1, x: 0, y: 0 };
            clamp();
            apply();
        },
        [apply, clamp],
    );

    // 확대 화면이 열려 있는 동안만 제스처를 듣는다.
    useEffect(() => {
        if (!zoomed) return undefined;
        const box = boxRef.current;
        if (!box) return undefined;

        tf.current = { scale: 1, x: 0, y: 0 };
        apply();
        // Map 자체는 재할당하지 않으므로 여기서 잡아두고 정리에 쓴다(훅 규칙 경고 회피 겸).
        const activePointers = pointers.current;

        /** @param {KeyboardEvent} e */
        const onKey = (e) => e.key === 'Escape' && setZoomed(false);

        // 트랙패드 핀치는 크롬·파이어폭스에서 ctrlKey가 붙은 wheel로 온다.
        // passive: false로 붙여야 preventDefault가 먹어 브라우저 전체 줌을 막을 수 있다.
        /** @param {WheelEvent} e */
        const onWheel = (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            zoomAt(tf.current.scale * (1 - e.deltaY * 0.01), e.clientX, e.clientY);
        };

        // 사파리(맥 트랙패드·iOS)는 wheel 대신 gesture 이벤트를 쏜다. 표준은 아니지만 사파리엔 이것뿐이다.
        let gestureBase = 1;
        /** @param {any} e */
        const onGestureStart = (e) => {
            e.preventDefault();
            gestureBase = tf.current.scale;
        };
        /** @param {any} e */
        const onGestureChange = (e) => {
            e.preventDefault();
            zoomAt(gestureBase * e.scale, e.clientX, e.clientY);
        };

        window.addEventListener('keydown', onKey);
        box.addEventListener('wheel', onWheel, { passive: false });
        box.addEventListener('gesturestart', onGestureStart);
        box.addEventListener('gesturechange', onGestureChange);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            box.removeEventListener('wheel', onWheel);
            box.removeEventListener('gesturestart', onGestureStart);
            box.removeEventListener('gesturechange', onGestureChange);
            document.body.style.overflow = prevOverflow;
            activePointers.clear();
            pinch.current = null;
        };
    }, [zoomed, apply, zoomAt]);

    // 터치 두 손가락 확대와 한 손가락 이동. 안드로이드처럼 gesture 이벤트가 없는 곳을 위해 직접 계산한다.
    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    const onPointerDown = (e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved.current = false;
        if (pointers.current.size === 1 && tf.current.scale > 1) e.currentTarget.setPointerCapture(e.pointerId);
    };

    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    const onPointerMove = (e) => {
        const pts = pointers.current;
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pts.size === 2) {
            const [a, b] = [...pts.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (!pinch.current) pinch.current = { dist, scale: tf.current.scale };
            else zoomAt((pinch.current.scale * dist) / pinch.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
            moved.current = true;
            return;
        }
        if (pts.size === 1 && tf.current.scale > 1 && prev) {
            tf.current.x += e.clientX - prev.x;
            tf.current.y += e.clientY - prev.y;
            if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 2) moved.current = true;
            clamp();
            apply();
        }
    };

    /** @param {import('react').PointerEvent<HTMLDivElement>} e */
    const onPointerUp = (e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
    };

    /**
     * 사진 바깥을 눌렀을 때만 닫는다.
     *
     * 확대는 transform이라 클릭 판정 영역(레이아웃 상자)은 커지지 않는다.
     * 그래서 img의 이벤트로 구분하면, 6배로 키웠을 때 실제로 보이는 영역의 대부분이
     * '배경'으로 잡혀 사진을 누르는 순간 닫혀버린다.
     * getBoundingClientRect()는 변환이 반영된 값을 주므로 그걸로 판정한다.
     * @param {import('react').MouseEvent<HTMLDivElement>} e
     */
    const onBackdropClick = (e) => {
        if (moved.current) return; // 끌어서 이동한 뒤의 클릭은 닫기가 아니다
        const r = imgRef.current?.getBoundingClientRect();
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
        setZoomed(false);
    };

    return (
        <>
            <style>{`
                .hp-wrap { position: relative; width: 84px; height: 84px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border-color, #ddd); background: var(--bg-color, #f4f4f4); flex-shrink: 0; }
                .hp-btn { display: block; width: 100%; height: 100%; padding: 0; border: none; background: none; cursor: zoom-in; }
                .hp-img { width: 100%; height: 100%; object-fit: cover; display: block; }
                .hp-msg { display: flex; align-items: center; justify-content: center; height: 100%; padding: 6px; font-size: .68rem; line-height: 1.35; text-align: center; color: var(--text-secondary, #999); box-sizing: border-box; word-break: keep-all; }
                /* 44px 터치 영역을 지키면서도 썸네일을 가리지 않도록 우상단에 겹쳐 둔다. */
                .hp-del { position: absolute; top: 0; right: 0; width: 28px; height: 28px; border: none; border-radius: 0 0 0 10px; background: rgba(0,0,0,.55); color: #fff; font-size: .8rem; line-height: 1; cursor: pointer; }

                /* 확대 화면. 점검 모달(10000) 위, 알림 토스트(12000) 아래에 둔다 —
                   확대 중에도 오류 알림은 보여야 한다.
                   touch-action: none이 있어야 브라우저가 제 방식대로 확대·스크롤하지 않고
                   두 손가락 동작이 pointer 이벤트로 넘어온다. */
                .hp-light { position: fixed; inset: 0; z-index: 11000; background: rgba(0,0,0,.85); display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; cursor: zoom-out; touch-action: none; overscroll-behavior: contain; }
                .hp-light img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; transform-origin: center; will-change: transform; user-select: none; -webkit-user-drag: none; }
                .hp-close { position: absolute; top: 16px; right: 16px; width: 44px; height: 44px; border: none; border-radius: 50%; background: rgba(255,255,255,.15); color: #fff; font-size: 1.2rem; cursor: pointer; z-index: 1; }
                .hp-hint { position: absolute; bottom: 16px; left: 0; right: 0; text-align: center; color: rgba(255,255,255,.6); font-size: .78rem; pointer-events: none; }
                @media print { .hp-light { display: none !important; } }
            `}</style>

            <div className="hp-wrap">
                {state === 'loading' && <div className="hp-msg">불러오는 중…</div>}
                {state === 'expired' && <div className="hp-msg">보관 기간 만료</div>}
                {state === 'error' && <div className="hp-msg">불러올 수 없음</div>}
                {state === 'ready' && (
                    <button className="hp-btn" onClick={() => setZoomed(true)} aria-label="사진 크게 보기">
                        <img className="hp-img" src={url} alt="점검 사진" />
                    </button>
                )}

                {onRemove && (
                    <button
                        className="hp-del"
                        onClick={(e) => {
                            e.stopPropagation(); // 삭제를 눌렀을 때 확대까지 열리지 않게
                            onRemove();
                        }}
                        aria-label="사진 삭제"
                    >
                        ✕
                    </button>
                )}
            </div>

            {zoomed && (
                <div
                    className="hp-light"
                    ref={boxRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onClick={onBackdropClick}
                    /* 두 번 누르면 1배 ↔ 2.5배를 오간다. 누른 지점을 기준으로 확대한다. */
                    onDoubleClick={(e) => zoomAt(tf.current.scale > 1 ? 1 : 2.5, e.clientX, e.clientY)}
                >
                    <img ref={imgRef} src={url} alt="점검 사진 확대" />
                    <button
                        className="hp-close"
                        onClick={(e) => {
                            e.stopPropagation();
                            setZoomed(false);
                        }}
                        aria-label="닫기"
                    >
                        ✕
                    </button>
                    <p className="hp-hint">두 손가락이나 두 번 누르기로 확대·축소 · 끌어서 이동</p>
                </div>
            )}
        </>
    );
}

export default HygienePhoto;
