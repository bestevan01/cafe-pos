import { createContext, useContext } from 'react';

/**
 * @typedef {object} NotifyOptions
 * @property {*} [icon] 토스트 좌측 아이콘(이모지 등)
 * @property {string} [title] 제목 줄
 * @property {number} [duration] 자동 닫힘(ms). 0이면 수동 닫기
 * @property {boolean} [loading] 로딩 스피너 표시
 * @property {string} [dedupeKey] 같은 키의 중복 토스트 억제
 * @property {number} [dedupeWindow] 중복 억제 시간(ms, 기본 3000)
 * @property {() => void} [onClick] 있으면 토스트를 눌렀을 때 실행하고 닫는다(알림에서 해당 화면으로 가기 등)
 */

/**
 * @typedef {object} ConfirmOptions
 * @property {string} [title]
 * @property {string} [confirmText]
 * @property {string} [cancelText]
 * @property {boolean} [danger] 확인 버튼을 위험(빨강) 스타일로
 */

/**
 * NotificationProvider가 주입하는 컨텍스트.
 * @typedef {object} NotificationApi
 * @property {(message: import('react').ReactNode, options?: NotifyOptions) => number|null} notify
 * @property {(id: number, patch: object) => void} update 떠 있는 토스트 내용 갱신
 * @property {(id: number) => void} dismiss 토스트 즉시 닫기
 * @property {(message: import('react').ReactNode, options?: ConfirmOptions) => Promise<boolean>} confirm
 */

export const NotificationContext = createContext(/** @type {NotificationApi|null} */ (null));

/**
 * 전역 알림 훅.
 *   const { notify, confirm } = useNotification();
 *   notify('저장되었습니다', { icon: '✅' });
 *   if (!(await confirm('정말 삭제하시겠습니까?', { danger: true }))) return;
 */
export function useNotification() {
    const ctx = useContext(NotificationContext);
    if (!ctx) throw new Error('useNotification은 <NotificationProvider> 안에서만 사용할 수 있습니다.');
    return ctx;
}
