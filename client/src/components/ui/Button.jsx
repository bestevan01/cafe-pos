import './Button.css';

/**
 * 공용 버튼. 디자인 토큰(--accent 등) 기반으로 전 화면 버튼 룩을 통일한다.
 *
 *   <Button onClick={save}>저장</Button>                 // primary(기본)
 *   <Button variant="secondary" icon="🧺">원재료</Button>  // 중립 외곽선
 *   <Button variant="danger" size="sm">삭제</Button>
 *   <Button variant="ghost">⬅ 뒤로</Button>
 *
 * 선언한 props 외 나머지(onClick, type, disabled, style 등)는 <button>에 그대로 전달되므로
 * ButtonHTMLAttributes와의 교차 타입으로 정의한다.
 *
 * @param {{
 *   variant?: 'primary'|'secondary'|'danger'|'success'|'warning'|'neutral'|'dark'|'ghost',
 *   size?: 'sm'|'md'|'lg',
 *   icon?: import('react').ReactNode,
 *   full?: boolean,
 *   className?: string,
 *   children?: import('react').ReactNode,
 * } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props
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
