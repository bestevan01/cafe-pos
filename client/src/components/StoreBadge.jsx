import { getStoreInfo } from '../utils/storeInfo';

/**
 * 지금 보고 있는 화면이 어느 매장 것인지 알리는 배지.
 *
 * 매장마다 백엔드와 DB가 완전히 분리돼 있어, 다른 매장 화면에서 주문을 받으면
 * 매출·시재가 통째로 엉뚱한 장부에 들어가고 마감 때까지 아무도 모른다.
 * 그래서 주문을 받기 직전에 거치는 화면들(로그인 → 역할 선택 → 캐셔,
 * 그리고 관리자 대시보드)마다 매장 색을 보여준다.
 *
 * 화면 제목 바로 위에 두는 것을 전제로 가운데 정렬과 아래 여백을 스스로 갖는다.
 * 여백을 조정해야 하면 className으로 덮어쓴다.
 *
 * 로그인 화면은 카드 상단을 꽉 채우는 띠 형태라 이 컴포넌트를 쓰지 않는다.
 * 카드 패딩을 음수 마진으로 상쇄해야 해서, 부모의 패딩 값을 알아야만 하기 때문이다.
 *
 * @param {object} props
 * @param {string} [props.className]
 * @returns {import('react').ReactElement|null} 매장 정보가 없으면 null(=아무것도 안 그림).
 */
function StoreBadge({ className = '' }) {
    const store = getStoreInfo();
    if (!store) return null;

    return (
        <>
            <style>
                {`
                /* width: fit-content + margin auto — 부모가 flex든 block이든 스스로 가운데에 선다.
                   (flex 부모에서 align-self를 쓰면 방향에 따라 결과가 달라진다) */
                .store-badge {
                    display: block; width: fit-content; margin: 0 auto 20px;
                    padding: 7px 20px; border-radius: 20px;
                    font-size: 0.95rem; font-weight: 600; letter-spacing: 0.5px;
                    text-align: center; word-break: keep-all;
                    /* 옅은 매장 색을 넣었을 때 배경에 묻히지 않도록 최소한의 윤곽 */
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.12);
                }
                `}
            </style>
            <span
                className={['store-badge', className].filter(Boolean).join(' ')}
                style={{ backgroundColor: store.bg, color: store.fg }}
            >
                {store.label}
            </span>
        </>
    );
}

export default StoreBadge;
