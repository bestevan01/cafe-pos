import './Button.css';

/**
 * 공용 버튼. 디자인 토큰(--accent 등) 기반으로 전 화면 버튼 룩을 통일한다.
 *
 *   <Button onClick={save}>저장</Button>                 // primary(기본)
 *   <Button variant="secondary" icon="🧺">원재료</Button>  // 중립 외곽선
 *   <Button variant="danger" size="sm">삭제</Button>
 *   <Button variant="ghost">⬅ 뒤로</Button>
 *
 * @param {object} props
 * @param {'primary'|'secondary'|'danger'|'success'|'warning'|'neutral'|'dark'|'ghost'} [props.variant]
 * @param {'sm'|'md'|'lg'} [props.size]
 * @param {import('react').ReactNode} [props.icon]      글자 앞 아이콘(이모지/노드)
 * @param {boolean} [props.full]                        true면 width:100%
 * @param {string} [props.className]                    추가 CSS 클래스
 * @param {import('react').ReactNode} [props.children]  버튼 내용
 * @remarks 나머지 props(onClick, type, disabled 등)는 <button>에 그대로 전달된다.
 */
function Button({ variant = 'primary', size = 'md', icon, full = false, className = '', children, ...rest }) {
    const cls = ['ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, full && 'ui-btn-full', className]
        .filter(Boolean)
        .join(' ');
    return (
        <button className={cls} {...rest}>
            {icon != null && <span className="ui-btn-icon">{icon}</span>}
            {children}
        </button>
    );
}

export default Button;
