import './Card.css';

/**
 * 공용 카드 컨테이너. 배경/테두리/라운드/그림자/패딩을 토큰으로 통일한다.
 *
 *   <Card>아무 내용</Card>
 *   <Card title="메뉴별 마진" icon="📊" subtitle="평균 70%" actions={<Button.../>}>
 *     ...
 *   </Card>
 *
 * @param {string} [title]            머리말 제목 (없으면 head 자체를 렌더 안 함)
 * @param {React.ReactNode} [icon]    제목 앞 아이콘
 * @param {React.ReactNode} [subtitle] 제목 옆 보조 텍스트
 * @param {React.ReactNode} [actions] 머리말 우측 액션(버튼 등)
 * @param {boolean} [flush]           true면 내부 패딩 제거(표/리스트가 가장자리까지)
 * @param {string} [className]        추가 CSS 클래스
 * @param {React.ReactNode} [children] 카드 본문
 * @param {object} [rest]             나머지 props → 최상위 div에 전달
 */
function Card({title, icon, subtitle, actions, flush = false, className = '', children, ...rest}) {
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
