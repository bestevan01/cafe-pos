import { useState, useEffect } from 'react';
import { getHygienePhotoUrl } from '../utils/hygienePhotos';

/**
 * 저장된 위생점검 사진 한 장.
 *
 * 서명 URL은 만료가 짧아서(10분) 미리 받아두지 않고 이 컴포넌트가 필요할 때 받아온다.
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
        // 응답이 늦게 와도 언마운트된 컴포넌트에 setState 하지 않도록 막는다.
        return () => {
            alive = false;
        };
    }, [photoId]);

    return (
        <div className="hp-wrap">
            <style>{`
                .hp-wrap { position: relative; width: 84px; height: 84px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border-color, #ddd); background: var(--bg-color, #f4f4f4); flex-shrink: 0; }
                .hp-img { width: 100%; height: 100%; object-fit: cover; display: block; }
                .hp-msg { display: flex; align-items: center; justify-content: center; height: 100%; padding: 6px; font-size: .68rem; line-height: 1.35; text-align: center; color: var(--text-secondary, #999); box-sizing: border-box; word-break: keep-all; }
                /* 44px 터치 영역을 지키면서도 썸네일을 가리지 않도록 우상단에 겹쳐 둔다. */
                .hp-del { position: absolute; top: 0; right: 0; width: 28px; height: 28px; border: none; border-radius: 0 0 0 10px; background: rgba(0,0,0,.55); color: #fff; font-size: .8rem; line-height: 1; cursor: pointer; }
            `}</style>

            {state === 'loading' && <div className="hp-msg">불러오는 중…</div>}
            {state === 'expired' && <div className="hp-msg">보관 기간 만료</div>}
            {state === 'error' && <div className="hp-msg">불러올 수 없음</div>}
            {state === 'ready' && <img className="hp-img" src={url} alt="점검 사진" />}

            {onRemove && (
                <button className="hp-del" onClick={onRemove} aria-label="사진 삭제">
                    ✕
                </button>
            )}
        </div>
    );
}

export default HygienePhoto;
