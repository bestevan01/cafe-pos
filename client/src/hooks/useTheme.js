import { useSyncExternalStore } from 'react';

/**
 * 테마(light/dark/system) 전역 단일 소스.
 * - 모듈 로드 시점에 즉시 적용(깜빡임 방지)
 * - setTheme로 변경하면 구독한 모든 컴포넌트(ThemeToggle, 모바일 드롭다운 등)가 함께 갱신
 */
const mql = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();
let theme = localStorage.getItem('theme') || 'system';

function apply() {
    const dark = theme === 'dark' || (theme === 'system' && mql.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** 저장된 사용자 테마를 다시 적용한다(다른 곳에서 data-theme을 임시로 덮어썼다가 되돌릴 때 사용). */
export function applyStoredTheme() {
    apply();
}

apply(); // import 시점에 곧바로 적용
mql.addEventListener('change', () => {
    if (theme === 'system') apply(); // 시스템 모드일 때만 OS 변경 추종
});

/** @param {'light'|'dark'|'system'} next */
export function setTheme(next) {
    theme = next;
    localStorage.setItem('theme', next);
    apply();
    listeners.forEach((fn) => fn());
}

/** @param {() => void} fn */
function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** const { theme, setTheme } = useTheme(); */
export function useTheme() {
    const current = useSyncExternalStore(subscribe, () => theme);
    return { theme: current, setTheme };
}
