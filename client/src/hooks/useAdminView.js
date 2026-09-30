import { useSyncExternalStore, useCallback } from 'react';

/**
 * 관리자 대시보드에서 '지금 어느 화면을 보고 있는지'를 컴포넌트 밖에 둔다.
 *
 * 알림 설정·내 정보·캐셔/주방 화면으로 가면 App이 대시보드 대신 그 화면을 그려
 * 대시보드가 통째로 내려간다. 화면 위치를 useState로 들고 있으면 돌아왔을 때
 * 전부 첫 화면으로 초기화된다. 여기 두면 다시 그려져도 보던 화면이 그대로 열린다.
 *
 * 메모리에만 둔다 — 새로고침하면 첫 화면부터 시작하는 것이 맞다.
 * 로그아웃하면 비운다(다음 사람이 앞사람이 보던 화면에서 시작하지 않게).
 */
/** @type {Map<string, any>} */
const views = new Map();
const listeners = new Set();

function emit() {
    listeners.forEach((fn) => fn());
}

/** @param {() => void} fn */
function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 기억해 둔 화면을 모두 비운다(로그아웃, 알림으로 특정 화면을 바로 여는 경우). */
export function resetAdminViews() {
    views.clear();
    emit();
}

/**
 * 모든 하위 화면을 첫 화면으로 되돌리고 대시보드에서 해당 화면을 연다.
 * @param {string} view  AdminDashboard의 화면 이름(예: 'inventory')
 */
export function openAdminView(view) {
    views.clear();
    views.set('dashboard', view);
    emit();
}

/**
 * useState와 같은 모양. key는 화면마다 겹치지 않게 짓는다(예: 'hygiene').
 * @template T
 * @param {string} key
 * @param {T} initial
 * @returns {[T, (next: T) => void]}
 */
export function useAdminView(key, initial) {
    const value = useSyncExternalStore(subscribe, () => (views.has(key) ? views.get(key) : initial));
    const setValue = useCallback(
        /** @param {T} next */ (next) => {
            views.set(key, next);
            emit();
        },
        [key],
    );
    return [value, setValue];
}
