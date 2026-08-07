import { useEffect } from 'react';
import { applyStoredTheme } from './useTheme';

/**
 * 시스템의 다크/라이트 모드 설정을 감지하여
 * 자동으로 앱의 테마를 변경해주는 커스텀 훅
 */
export const useSystemTheme = () => {
    useEffect(() => {
        const root = document.documentElement;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        /** @param {MediaQueryList|MediaQueryListEvent} e */
        const applySystemTheme = (e) => {
            root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        };

        // 초기 실행 및 시스템 설정 변경 감지
        applySystemTheme(mediaQuery);
        mediaQuery.addEventListener('change', applySystemTheme);

        return () => {
            mediaQuery.removeEventListener('change', applySystemTheme);
            // 화면을 벗어나면 사용자가 저장해둔 테마 설정으로 되돌린다.
            applyStoredTheme();
        };
    }, []);
};
