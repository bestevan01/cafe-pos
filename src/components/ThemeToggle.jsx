import { useState, useEffect, useRef } from 'react';

export default function ThemeToggle() {
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system');
    const [isOpen, setIsOpen] = useState(false);

    // 🌟 추가: 팝업의 위치를 동적으로 관리할 상태
    const [menuStyle, setMenuStyle] = useState({ left: '50%', transform: 'translateX(-50%)' });
    const dropdownRef = useRef(null);

    // 드롭다운 바깥 영역 클릭 시 닫기
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        // 모바일 터치 호환성을 위해 mousedown 대신 pointerdown 사용
        document.addEventListener("pointerdown", handleClickOutside);
        return () => document.removeEventListener("pointerdown", handleClickOutside);
    }, []);

    // 🌟 핵심: 메뉴가 열릴 때 화면 바깥으로 튀어나가는지 검사해서 위치 조정
    useEffect(() => {
        if (isOpen && dropdownRef.current) {
            const rect = dropdownRef.current.getBoundingClientRect(); // 버튼의 현재 위치
            const menuWidth = 160; // 팝업 메뉴의 대략적인 넓이
            const margin = 15; // 화면 끝에서 최소한 띄울 여백

            const buttonCenter = rect.left + (rect.width / 2);

            // 1. 오른쪽으로 화면을 뚫고 나갈 것 같다면? -> 버튼 오른쪽 끝에 맞춤
            if (buttonCenter + (menuWidth / 2) > window.innerWidth - margin) {
                setMenuStyle({ right: 0, left: 'auto', transform: 'none' });
            }
            // 2. 왼쪽으로 화면을 뚫고 나갈 것 같다면? -> 버튼 왼쪽 끝에 맞춤
            else if (buttonCenter - (menuWidth / 2) < margin) {
                setMenuStyle({ left: 0, right: 'auto', transform: 'none' });
            }
            // 3. 공간이 넉넉하다면? -> 원래대로 버튼 정중앙에 예쁘게 배치
            else {
                setMenuStyle({ left: '50%', transform: 'translateX(-50%)' });
            }
        }
    }, [isOpen]);

    // 테마 적용 및 시스템 설정 감지 로직
    useEffect(() => {
        const root = document.documentElement;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const applyTheme = (currentTheme) => {
            if (currentTheme === 'dark') {
                root.setAttribute('data-theme', 'dark');
            } else if (currentTheme === 'light') {
                root.setAttribute('data-theme', 'light');
            } else {
                if (mediaQuery.matches) {
                    root.setAttribute('data-theme', 'dark');
                } else {
                    root.setAttribute('data-theme', 'light');
                }
            }
        };

        applyTheme(theme);
        localStorage.setItem('theme', theme);

        const handleChange = () => {
            if (theme === 'system') applyTheme('system');
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    const getCurrentIcon = () => {
        if (theme === 'light') return '☀️';
        if (theme === 'dark') return '🌙';
        return '💻';
    };

    return (
        <div className="theme-dropdown-container" ref={dropdownRef}>
            <style>
                {`
                .theme-dropdown-container {
                    position: relative;
                    display: inline-block;
                }
                
                .theme-trigger-btn {
                    background: var(--card-bg, #fff);
                    border: 1px solid var(--border-color, #ccc);
                    border-radius: 50%;
                    width: 36px; height: 36px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 1.2rem; cursor: pointer;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                    transition: transform 0.1s, background-color 0.3s;
                    color: var(--text-primary, #333);
                }
                .theme-trigger-btn:active { transform: scale(0.95); }
                
                .theme-menu {
                    position: absolute;
                    top: calc(100% + 10px);
                    background-color: var(--card-bg, #fff);
                    border: 1px solid var(--border-color, #ddd);
                    border-radius: 12px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.15);
                    padding: 8px;
                    min-width: 150px;
                    z-index: 10000;
                    display: flex; flex-direction: column; gap: 4px;
                    
                    /* 🌟 애니메이션에서 transform을 제거하여 동적 포지셔닝과 충돌 방지 */
                    animation: fadeInDrop 0.15s ease-out forwards;
                }
                
                @keyframes fadeInDrop {
                    from { opacity: 0; margin-top: -10px; }
                    to { opacity: 1; margin-top: 0; }
                }

                .theme-menu-item {
                    background: none; border: none; width: 100%; text-align: left;
                    padding: 10px 12px; border-radius: 8px; cursor: pointer;
                    font-size: 0.95rem; color: var(--text-primary, #333);
                    display: flex; align-items: center; gap: 12px;
                    transition: background-color 0.2s;
                }
                @media (hover: hover) {
                    .theme-menu-item:hover { background-color: var(--bg-color, #f4f6f8); }
                }
                
                .theme-menu-item.active {
                    background-color: rgba(0, 123, 255, 0.1);
                    color: #007bff; font-weight: bold;
                }
                
                /* 📱 모바일 화면 최적화 */
                @media (max-width: 768px) {
                    .theme-trigger-btn { width: 32px; height: 32px; font-size: 1rem; }
                    .theme-menu { min-width: 140px; }
                    .theme-menu-item { padding: 8px 10px; font-size: 0.9rem; }
                }
                `}
            </style>

            <button className="theme-trigger-btn" onClick={() => setIsOpen(!isOpen)} title="테마 설정">
                {getCurrentIcon()}
            </button>

            {/* 🌟 계산된 menuStyle을 style 속성으로 직접 주입 */}
            {isOpen && (
                <div className="theme-menu" style={menuStyle}>
                    <button className={`theme-menu-item ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
                        <span>☀️</span> 라이트 모드
                    </button>
                    <button className={`theme-menu-item ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
                        <span>🌙</span> 다크 모드
                    </button>
                    <button className={`theme-menu-item ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')}>
                        <span>💻</span> 시스템 설정
                    </button>
                </div>
            )}
        </div>
    );
}