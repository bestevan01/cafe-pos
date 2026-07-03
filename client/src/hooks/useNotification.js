import { createContext, useContext } from 'react';

/** NotificationProvider가 주입하는 컨텍스트 ({ notify, confirm }) */
export const NotificationContext = createContext(null);

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
