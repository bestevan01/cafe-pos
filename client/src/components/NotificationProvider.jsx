import {useState, useCallback, useMemo, useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {motion, AnimatePresence} from 'framer-motion';
import axios from 'axios';
import {NotificationContext} from '../hooks/useNotification';

/**
 * 전역 알림 시스템.
 * - notify(message, options?)  : 오른쪽 상단 토스트 (alert 대체, 논블로킹). 토스트 id 반환.
 *      options = { icon, title, duration(ms, 0이면 수동 닫기),
 *                  dedupeKey(같은 키로 dedupeWindow(기본 3초) 내 재호출 시 무시 → 화면당 1개) }
 * - confirm(message, options?) : 중앙 확인 다이얼로그 (window.confirm 대체). Promise<boolean> 반환.
 *      options = { title, confirmText, cancelText, danger }
 *
 * 호출은 useNotification 훅으로 한다 (src/hooks/useNotification.js).
 */
let idCounter = 0;

export function NotificationProvider({children}) {
    const [toasts, setToasts] = useState(/** @type {{id: number, message: React.ReactNode, icon?: *, title?: string, loading?: boolean}[]} */ ([]));
    const [confirmState, setConfirmState] = useState(null); // { message, title, confirmText, cancelText, danger, resolve }

    // 화면 폭으로 토스트 표현 분기: PC=우측상단 카드 / 모바일=하단 스낵바
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches
    );
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 480px)');
        const onChange = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const dedupeRef = useRef({}); // { [dedupeKey]: 마지막 표시 시각 }

    /**
     * @param {React.ReactNode} message
     * @param {{icon?: *, title?: string, duration?: number, loading?: boolean, dedupeKey?: string, dedupeWindow?: number}} [options]
     * @returns {number|null}
     */
    const notify = useCallback((message, options = {}) => {
        // 같은 dedupeKey로 짧은 시간 내 재호출되면 무시 (동시 로딩 실패 등을 하나로 묶음)
        if (options.dedupeKey) {
            const now = Date.now();
            const win = options.dedupeWindow ?? 3000;
            if (now - (dedupeRef.current[options.dedupeKey] || 0) < win) return null;
            dedupeRef.current[options.dedupeKey] = now;
        }
        const id = ++idCounter;
        const duration = options.duration ?? 3000;
        setToasts(prev => [...prev, {id, message, icon: options.icon, title: options.title, loading: options.loading}]);
        if (duration > 0) setTimeout(() => removeToast(id), duration);
        return id;
    }, [removeToast]);

    // 이미 떠 있는 토스트 내용 갱신 (예: 로딩 중 메시지 변경)
    const update = useCallback((id, patch) => {
        setToasts(prev => prev.map(t => t.id === id ? {...t, ...patch} : t));
    }, []);

    const confirm = useCallback((message, options = {}) => {
        return new Promise((resolve) => {
            setConfirmState({
                message,
                title: options.title ?? '확인',
                confirmText: options.confirmText ?? '확인',
                cancelText: options.cancelText ?? '취소',
                danger: options.danger ?? false,
                resolve,
            });
        });
    }, []);

    const closeConfirm = useCallback((result) => {
        setConfirmState(prev => {
            if (prev) prev.resolve(result);
            return null;
        });
    }, []);

    // 다이얼로그 열렸을 때: Enter=확인 / Esc=취소, 배경 스크롤 잠금
    useEffect(() => {
        if (!confirmState) return;
        const onKey = (e) => {
            if (e.key === 'Enter') closeConfirm(true);
            else if (e.key === 'Escape') closeConfirm(false);
        };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [confirmState, closeConfirm]);

    // 전역 로딩 표시: 느린 백엔드 요청(1초+)에 자동으로 로딩 토스트를 띄운다.
    // /ping(예열) 및 { meta: { silent: true } } 요청은 제외.
    useEffect(() => {
        const SHOW_DELAY = 1000;       // 1초 안에 안 끝나면 토스트 표시
        const ESCALATE_DELAY = 4000;   // 4초 넘으면 "서버 깨우는 중" 문구로 전환

        let pending = 0;
        let toastId = null;
        let showTimer = null;
        let escalateTimer = null;

        const isSilent = (config) => {
            const url = (config && config.url) || '';
            return url.includes('/ping') || !!(config && config.meta && config.meta.silent);
        };

        const startTimers = () => {
            if (showTimer || toastId != null) return; // 이미 진행 중이면 중복 시작 안 함
            showTimer = setTimeout(() => {
                showTimer = null;
                toastId = notify('서버 응답을 기다리는 중이에요...', {loading: true, title: '잠시만 기다려주세요', duration: 0});
                escalateTimer = setTimeout(() => {
                    escalateTimer = null;
                    if (toastId != null) update(toastId, {message: '서버를 깨우는 중이에요. 최대 1분 정도 걸릴 수 있어요 ☕'});
                }, ESCALATE_DELAY - SHOW_DELAY);
            }, SHOW_DELAY);
        };

        const clearTimers = () => {
            if (showTimer) {
                clearTimeout(showTimer);
                showTimer = null;
            }
            if (escalateTimer) {
                clearTimeout(escalateTimer);
                escalateTimer = null;
            }
            if (toastId != null) {
                removeToast(toastId);
                toastId = null;
            }
        };

        const settle = (config) => {
            if (config && config.meta && config.meta._loadingCounted) {
                pending = Math.max(0, pending - 1);
                if (pending === 0) clearTimers();
            }
        };

        const reqId = axios.interceptors.request.use((config) => {
            if (!isSilent(config)) {
                config.meta = {...(config.meta || {}), _loadingCounted: true};
                pending += 1;
                startTimers();
            }
            return config;
        });

        const resId = axios.interceptors.response.use(
            (response) => {
                settle(response.config);
                return response;
            },
            (error) => {
                settle(error.config);
                // 만료·무효 토큰(401): 로그인/회원가입 외의 호출이 401이면 세션 만료로 보고 전역 로그아웃을 유도.
                // 토큰을 즉시 비워 동일 401 폭주 시 중복 발화를 막는다.
                const url = error.config?.url || '';
                const isAuthEndpoint = url.includes('/api/login') || url.includes('/api/register');
                if (error.response?.status === 401 && !isAuthEndpoint && localStorage.getItem('token')) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    localStorage.removeItem('lastActivity');
                    window.dispatchEvent(new CustomEvent('app:session-expired'));
                }
                return Promise.reject(error);
            }
        );

        return () => {
            axios.interceptors.request.eject(reqId);
            axios.interceptors.response.eject(resId);
            clearTimers();
        };
    }, [notify, update, removeToast]);

    const value = useMemo(() => ({
        notify,
        update,
        dismiss: removeToast,
        confirm
    }), [notify, update, removeToast, confirm]);

    // 모바일: 아래에서 위로(스낵바) / PC: 오른쪽에서 슬라이드-인
    /** @type {import('framer-motion').MotionProps} */
    const toastAnim = isMobile
        ? {
            initial: {opacity: 0, y: 30, scale: 0.98},
            animate: {opacity: 1, y: 0, scale: 1},
            exit: {opacity: 0, y: 30, scale: 0.96}
        }
        : {
            initial: {opacity: 0, x: 24, scale: 0.96},
            animate: {opacity: 1, x: 0, scale: 1},
            exit: {opacity: 0, x: 24, scale: 0.9}
        };

    // noinspection JSValidateTypes -- framer-motion <motion.div>의 복잡한 타입을 WebStorm이 검증하지 못해 생기는 오탐 억제 (코드는 정상, 빌드 통과)
    return (
        <NotificationContext.Provider value={value}>
            {children}
            {createPortal(
                <>
                    <style>{`
                        /* ===== 토스트 스택 (오른쪽 상단) ===== */
                        .ntf-toast-stack { position: fixed; top: 20px; right: 20px; z-index: 12000; display: flex; flex-direction: column; gap: 10px; max-width: calc(100vw - 40px); pointer-events: none; }
                        .ntf-toast {
                            pointer-events: auto;
                            display: flex; align-items: center; gap: 12px;
                            width: 340px; max-width: 100%;
                            padding: 14px 16px;
                            background-color: var(--card-bg, #fff); color: var(--text-primary, #333);
                            border: 1px solid var(--border-color, rgba(0,0,0,0.08));
                            border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.18);
                            backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
                            box-sizing: border-box;
                        }
                        .ntf-toast-icon { flex-shrink: 0; font-size: 1.6rem; line-height: 1; }
                        .ntf-toast-spinner { flex-shrink: 0; width: 24px; height: 24px; border: 3px solid var(--border-color, #e0e0e0); border-top-color: var(--accent); border-radius: 50%; animation: ntf-spin 0.8s linear infinite; }
                        @keyframes ntf-spin { to { transform: rotate(360deg); } }
                        .ntf-toast-text { flex: 1; min-width: 0; text-align: left; }
                        .ntf-toast-title { margin: 0 0 2px 0; font-size: 0.95rem; font-weight: 700; }
                        .ntf-toast-msg { margin: 0; font-size: 0.88rem; color: var(--text-secondary, #666); line-height: 1.4; white-space: pre-line; word-break: keep-all; }
                        .ntf-toast-close { flex-shrink: 0; align-self: flex-start; background: none; border: none; color: var(--text-secondary, #999); font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 2px 4px; }

                        /* ===== 확인 다이얼로그 (중앙) ===== */
                        .ntf-dialog-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 12000; padding: 20px; box-sizing: border-box; animation: ntf-fade 0.15s ease; }
                        @keyframes ntf-fade { from { opacity: 0; } to { opacity: 1; } }
                        .ntf-dialog { background-color: var(--card-bg, #fff); color: var(--text-primary, #333); border: 1px solid var(--border-color, transparent); border-radius: var(--radius-lg, 16px); box-shadow: 0 10px 30px rgba(0,0,0,0.25); width: 100%; max-width: 360px; padding: 26px 24px; text-align: center; box-sizing: border-box; animation: ntf-pop 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
                        @keyframes ntf-pop { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
                        .ntf-dialog-title { margin: 0 0 10px 0; font-size: 1.2rem; font-weight: 700; }
                        .ntf-dialog-msg { margin: 0 0 22px 0; font-size: 0.95rem; color: var(--text-secondary, #666); line-height: 1.55; white-space: pre-line; word-break: keep-all; }
                        .ntf-dialog-actions { display: flex; gap: 10px; }
                        .ntf-btn { flex: 1; padding: 13px; border: none; border-radius: var(--radius-md, 10px); font-size: 1rem; font-weight: bold; cursor: pointer; transition: transform 0.1s, opacity 0.2s; }
                        .ntf-btn:active { transform: scale(0.97); }
                        .ntf-btn-cancel { background-color: var(--border-color, #e9ecef); color: var(--text-primary, #333); }
                        .ntf-btn-confirm { background-color: var(--accent); color: #fff; }
                        .ntf-btn-danger { background-color: var(--danger); color: #fff; }

                        /* 모바일: 하단 스낵바 (아래에서 위로 올라옴, 풀폭). 메시지는 좌측 정렬 유지.
                           ※ base의 max-width를 풀어야 left/right가 먹어 박스가 좌우 가운데로 옴 */
                        @media (max-width: 480px) {
                            .ntf-toast-stack { top: auto; bottom: 16px; right: 12px; left: 12px; max-width: none; }
                            .ntf-toast { width: 100%; }
                        }
                    `}</style>

                    <div className="ntf-toast-stack">
                        <AnimatePresence initial={true}>
                            {toasts.map(t => (
                                <motion.div
                                    key={t.id}
                                    className="ntf-toast"
                                    role="status"
                                    layout
                                    {...toastAnim}
                                    transition={{duration: 0.25, ease: [0.16, 1, 0.3, 1]}}
                                >
                                    {t.loading
                                        ? <span className="ntf-toast-spinner"/>
                                        : (t.icon && <span className="ntf-toast-icon">{t.icon}</span>)}
                                    <div className="ntf-toast-text">
                                        {t.title && <p className="ntf-toast-title">{t.title}</p>}
                                        <p className="ntf-toast-msg">{t.message}</p>
                                    </div>
                                    {!t.loading && <button className="ntf-toast-close" onClick={() => removeToast(t.id)}
                                                           aria-label="닫기">×</button>}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>

                    {confirmState && (
                        <div className="ntf-dialog-overlay" onClick={() => closeConfirm(false)}>
                            <div className="ntf-dialog" role="dialog" aria-modal="true"
                                 onClick={(e) => e.stopPropagation()}>
                                <h2 className="ntf-dialog-title">{confirmState.title}</h2>
                                <p className="ntf-dialog-msg">{confirmState.message}</p>
                                <div className="ntf-dialog-actions">
                                    <button className="ntf-btn ntf-btn-cancel" onClick={() => closeConfirm(false)}>
                                        {confirmState.cancelText}
                                    </button>
                                    <button
                                        className={`ntf-btn ${confirmState.danger ? 'ntf-btn-danger' : 'ntf-btn-confirm'}`}
                                        onClick={() => closeConfirm(true)}
                                        autoFocus
                                    >
                                        {confirmState.confirmText}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>,
                document.body
            )}
        </NotificationContext.Provider>
    );
}
