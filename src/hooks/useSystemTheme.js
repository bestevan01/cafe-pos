import {useEffect} from 'react';

/**
 * 시스템의 다크/라이트 모드 설정을 감지하여
 * 자동으로 앱의 테마를 변경해주는 커스텀 훅
 */
export const useSystemTheme = () => {
    useEffect(() => {
        const root = document.documentElement;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const applySystemTheme = (e) => {
            if (e.matches) {
                root.setAttribute('data-theme', 'dark');
            } else {
                root.setAttribute('data-theme', 'light');
            }
        };

        // 1. 컴포넌트가 켜질 때 즉시 시스템 테마 적용
        applySystemTheme(mediaQuery);

        // 2. 시스템 테마가 실시간으로 바뀔 때 감지
        mediaQuery.addEventListener('change', applySystemTheme);

        return () => {
            mediaQuery.removeEventListener('change', applySystemTheme);
        };
    }, []);
};