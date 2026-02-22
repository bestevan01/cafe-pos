import { useState, useEffect, useRef } from 'react';

export default function ThemeToggle() {
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system');
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState({ left: '50%', transform: 'translateX(-50%)' });
    const dropdownRef = useRef(null);

    // 1. 드롭다운 외부 클릭 감지 (닫기)
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("pointerdown", handleClickOutside);
        return () => document.removeEventListener("pointerdown", handleClickOutside);
    }, []);

    // 2. 드롭다운 위치 자동 보정 (화면 이탈 방지)
    useEffect(() => {
        if (isOpen && dropdownRef.current) {
            const rect = dropdownRef.current.getBoundingClientRect();
            const menuWidth = 160;
            const margin = 15;
            const buttonCenter = rect.left + (rect.width / 2);

            // 화면 오른쪽을 벗어나는 경우
            if (buttonCenter + (menuWidth / 2) > window.innerWidth - margin) {
                setMenuStyle({right: '0', left: 'auto', transform: 'none'});
            }
            // 화면 왼쪽을 벗어나는 경우
            else if (buttonCenter - (menuWidth / 2) < margin) {
                setMenuStyle({left: '0', right: 'auto', transform: 'none'});
            }
            // 공간이 충분하면 중앙 정렬
            else {
                setMenuStyle({ left: '50%', transform: 'translateX(-50%)' });
            }
        }
    }, [isOpen]);

    // 3. 테마 적용 및 시스템 설정 변경 감지
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
        localStorage.setItem('theme', String(theme));

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
                    border-radius: var(--radius-md);
                    box-shadow: 0 5px 15px rgba(0,0,0,0.15);
                    padding: 8px;
                    min-width: 150px;
                    z-index: 10000;
                    display: flex; flex-direction: column; gap: 4px;
                    animation: fadeInDrop 0.15s ease-out forwards;
                }
                
                @keyframes fadeInDrop {
                    from { opacity: 0; margin-top: -10px; }
                    to { opacity: 1; margin-top: 0; }
                }

                .theme-menu-item {
                    background: none; border: none; width: 100%; text-align: left;
                    padding: 10px 12px; 
                    border-radius: var(--radius-sm);
                    cursor: pointer;
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