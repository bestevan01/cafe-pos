import './Card.css';

/**
 * 공용 카드 컨테이너. 배경/테두리/라운드/그림자/패딩을 토큰으로 통일한다.
 *
 *   <Card>아무 내용</Card>
 *   <Card title="메뉴별 마진" icon="📊" subtitle="평균 70%" actions={<Button.../>}>
 *     ...
 *   </Card>
 *
 * 선언한 props 외 나머지는 최상위 div에 그대로 전달되므로 HTMLAttributes와의 교차 타입으로 정의한다.
 *
 * @param {{
 *   title?: string,
 *   icon?: import('react').ReactNode,
 *   subtitle?: import('react').ReactNode,
 *   actions?: import('react').ReactNode,
 *   flush?: boolean,
 *   className?: string,
 *   children?: import('react').ReactNode,
 * } & import('react').HTMLAttributes<HTMLDivElement>} props
 */
function Card({ title, icon, subtitle, actions, flush = false, className = '', children, ...rest }) {
    const cls = ['ui-card', flush && 'ui-card-flush', className].filter(Boolean).join(' ');
    const hasHead = title != null || actions != null;
    return (
        <div className={cls} {...rest}>
            {hasHead && (
                <div className="ui-card-head">
                    <h3 className="ui-card-title">
                        {icon != null && <span className="ui-card-icon">{icon}</span>}
                        {title}
                        {subtitle != null && <span className="ui-card-sub">{subtitle}</span>}
                    </h3>
                    {actions != null && <div className="ui-card-actions">{actions}</div>}
                </div>
            )}
            {children}
        </div>
    );
}

export default Card;
