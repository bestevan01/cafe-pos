import axios from 'axios';
import { useState, useEffect, useCallback, useRef } from 'react';
import ThemeToggle from '../../components/ThemeToggle';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { useNotification } from '../../hooks/useNotification';
import { useDragSort } from '../../hooks/useDragSort';
import { MENU_CATEGORIES, categoryLabel } from '../../utils/menuCategories';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 */
function MenuDashboard({ onBack }) {
    const { notify, confirm } = useNotification();
    // ---------------------------------------------------------
    // [1] 상태 관리 (State)
    // ---------------------------------------------------------
    const [menuList, setMenuList] = useState(/** @type {import('../../types').Menu[]} */ ([]));
    const [editingId, setEditingId] = useState(/** @type {string|null} */ (null));
    const [formData, setFormData] = useState({ name: '', price: '', type: 'coffee' });
    // 드래그 중에는 최신 목록을 클로저가 아니라 ref로 읽는다(포인터 이벤트가 렌더보다 자주 온다).
    const menuRef = useRef(menuList);
    useEffect(() => {
        menuRef.current = menuList;
    }, [menuList]);
    // effect가 최신 saveOrder를 읽도록 ref에 담아 둔다.
    const saveOrderRef = useRef(/** @type {(next: any[]) => void} */ (() => {}));

    // 끌어서 순서 바꾸기. 뜨는 행·부드러운 밀림·자동 스크롤은 전부 훅이 담당한다.
    // 위생 점검 체크리스트와 같은 훅을 써서 두 화면의 조작감을 맞춘다.
    const { dragId, dragStart } = useDragSort({
        onReorder: (from, to) =>
            setMenuList((prev) => {
                const next = [...prev];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                return next;
            }),
        onCommit: () => saveOrderRef.current(menuRef.current),
    });

    // API 권한 토큰
    const getAuthHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    // ---------------------------------------------------------
    // [2] API 통신 로직
    // ---------------------------------------------------------
    const fetchMenu = useCallback(async () => {
        try {
            const res = await axios.get('/api/menu', getAuthHeader());
            setMenuList(res.data);
        } catch {
            notify('메뉴 불러오기 실패', { icon: '⚠️' });
        }
    }, [notify]);

    useEffect(() => {
        // fetchMenu는 useCallback으로 메모이즈된 비동기 함수라 setState가 await 이후에만 일어남(effect 본문에서 동기 호출 아님) — 규칙 오탐.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void fetchMenu();
    }, [fetchMenu]);

    /** @param {import('react').FormEvent<HTMLFormElement>} e */
    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            await axios.post('/api/menu', formData, getAuthHeader());
            notify('메뉴가 추가되었습니다.', { icon: '✅' });
            setFormData({ name: '', price: '', type: 'coffee' });
            await fetchMenu();
        } catch {
            notify('추가 실패', { icon: '⚠️' });
        }
    };

    /** @param {string} id */
    const handleDelete = async (id) => {
        if (
            !(await confirm('정말 이 메뉴를 삭제하시겠습니까?', {
                title: '메뉴 삭제',
                confirmText: '삭제',
                danger: true,
            }))
        )
            return;
        try {
            await axios.delete(`/api/menu/${id}`, getAuthHeader());
            await fetchMenu();
        } catch {
            notify('삭제 실패', { icon: '⚠️' });
        }
    };

    const handleUpdate = async () => {
        try {
            await axios.patch(`/api/menu/${editingId}`, formData, getAuthHeader());
            notify('수정되었습니다.', { icon: '✅' });
            setEditingId(null);
            setFormData({ name: '', price: '', type: 'coffee' });
            await fetchMenu();
        } catch {
            notify('수정 실패', { icon: '⚠️' });
        }
    };

    /** @param {import('../../types').Menu} menu */
    const toggleSoldOut = async (menu) => {
        try {
            const newVal = menu.is_soldout ? 0 : 1;
            await axios.patch(`/api/menu/${menu.id}`, { is_soldout: newVal }, getAuthHeader());
            await fetchMenu();
        } catch {
            notify('상태 변경 실패', { icon: '⚠️' });
        }
    };

    /** 화면에 보이는 순서 그대로 서버에 넘겨 sort_order를 다시 매긴다(화면 반영은 드래그 중에 이미 끝나 있다). */
    /** @param {import('../../types').Menu[]} next */
    const saveOrder = async (next) => {
        try {
            await axios.put('/api/menu/order', { ids: next.map((m) => m.id) }, getAuthHeader());
        } catch {
            notify('순서 저장에 실패했습니다.', { icon: '⚠️' });
            void fetchMenu(); // 서버가 진짜로 갖고 있는 순서로 되돌린다
        }
    };

    // 렌더마다 최신 saveOrder를 ref에 담아 둔다(드래그 effect가 옛 클로저를 붙잡지 않도록).
    useEffect(() => {
        saveOrderRef.current = saveOrder;
    });

    // ---------------------------------------------------------
    // [3] 이벤트 핸들러 및 헬퍼
    // ---------------------------------------------------------

    /** @param {any} e */
    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    /** @param {import('../../types').Menu} menu */
    const startEdit = (menu) => {
        setEditingId(menu.id);
        setFormData({ name: menu.name, price: String(menu.price), type: menu.type });
        // 모바일 환경 UX: 수정 버튼 클릭 시 폼 위치로 스크롤 이동
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // ---------------------------------------------------------
    // [4] 렌더링 (Render)
    // ---------------------------------------------------------
    return (
        <div className="menu-container">
            <style>
                {`
                /* 전체 레이아웃 */
                /* 메뉴가 늘어나면 페이지 전체가 스크롤돼 입력 폼과 표 머리글까지 같이 올라간다.
                   컨테이너를 화면 높이에 가두고 안에서 높이를 나눠, 표 본문만 스크롤하게 한다.
                   overflow는 걸지 않는다 — 테마 드롭다운 같은 절대배치 요소가 잘릴 수 있고,
                   flex 배분이 맞으면 넘칠 일도 없다. */
                .menu-container { padding: 20px; background-color: var(--bg-color, #f4f6f8); height: 100dvh; display: flex; flex-direction: column; box-sizing: border-box; transition: background-color 0.3s ease; }
                
                /* 헤더 영역 */
                .menu-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: nowrap; gap: 15px; }
                /* 내용이 길어져도 뒤로/제목/테마 버튼은 항상 닿을 수 있게 상단 고정.
                   컨테이너 좌우 패딩을 음수 마진으로 상쇄해 배경이 화면 폭을 채운다. */
                .menu-header {
                    position: sticky; top: 0; z-index: 30;
                    margin: -20px -20px 20px -20px; padding: 12px 20px;
                    background: var(--bg-color, #f4f6f8);
                    border-bottom: 1px solid var(--border-color, rgba(0,0,0,.08));
                }
                .header-left { display: flex; align-items: center; gap: 15px; }
                .menu-title { margin: 0; color: var(--text-primary, #333); font-size: 1.8rem; white-space: nowrap; }
                .theme-wrapper { display: flex; align-items: center; }

                /* 컨텐츠 영역 (폼 + 리스트) */
                /* min-height: 0 이 없으면 flex 자식이 내용 높이 아래로 못 줄어들어 표가 화면 밖으로 넘친다. */
                .menu-content { display: flex; gap: 20px; align-items: stretch; flex: 1; min-height: 0; }
                
                /* 입력 폼 섹션 */
                /* 부모가 스크롤하지 않으므로 sticky가 불필요하다(기존 top: 20px는 고정 헤더에 가려 잘렸다).
                   align-self로 세로 늘어남을 막고, 창이 낮을 때를 대비해 폼 자체만 스크롤시킨다. */
                .form-section { width: 320px; flex-shrink: 0; box-sizing: border-box; align-self: flex-start; max-height: 100%; overflow-y: auto; } /* 카드 외형은 공용 <Card>가 담당 */
                .form-title { margin-top: 0; margin-bottom: 15px; color: var(--text-primary, #333); }
                .menu-input { padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color, #ddd); font-size: 1rem; background-color: var(--bg-color, #f4f6f8); color: var(--text-primary, #333); width: 100%; box-sizing: border-box; margin-bottom: 10px; -webkit-appearance: none; }
                .menu-input:focus { outline: none; border-color: var(--accent); }
                

                /* 리스트 섹션 */
                .list-section { flex: 1; overflow: hidden; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; min-height: 0; } /* 카드 외형은 공용 <Card>가 담당 */
                .menu-table-scroll { flex: 1; min-height: 0; overflow-y: auto; }
                
                /* PC 테이블 뷰 */
                .menu-table-view { width: 100%; border-collapse: collapse; }
                /* 머리글 고정. border-collapse: collapse에서는 th의 border가 sticky를 따라오지 않고
                   제자리에 남아버리므로, 밑줄을 box-shadow로 그린다. 배경도 깔아야 본문이 비쳐 보이지 않는다. */
                .menu-table-view th { position: sticky; top: 0; z-index: 1; background: var(--card-bg, #fff); padding: 15px 10px; color: var(--text-secondary, #666); text-align: left; box-shadow: inset 0 -2px 0 var(--border-color, #ddd); white-space: nowrap; }
                .menu-table-view td { padding: 15px 10px; color: var(--text-primary, #333); border-bottom: 1px solid var(--border-color, #eee); }
                .menu-card-view { display: none; }

                /* 순서 변경 손잡이. touch-action: none이 없으면 터치 드래그가 페이지 스크롤에 먹힌다. */
                .col-grip { width: 34px; }
                .menu-grip { touch-action: none; cursor: grab; user-select: none; text-align: center; color: var(--text-secondary, #bbb); font-size: 1rem; line-height: 1; padding: 6px 4px; }
                .menu-grip:active { cursor: grabbing; }
                /* 잡은 행은 공중에 뜬 것처럼 보여야 어디로 가고 있는지 눈으로 쫓을 수 있다.
                   border-collapse: collapse에서는 tr에 건 그림자가 그려지지 않으므로 td에 건다.
                   변형(translateY)은 훅이 tr에 직접 넣는다 — tr에 position/z-index가 있어야
                   다른 행 위로 올라온다. */
                .menu-table-view tr.dragging { position: relative; z-index: 5; }
                .menu-table-view tr.dragging td {
                    background: var(--card-bg, #fff);
                    box-shadow: 0 8px 20px rgba(0,0,0,.18);
                    cursor: grabbing;
                }
                .menu-hint { margin: 0 0 10px; font-size: 0.85rem; color: var(--text-secondary, #888); }

                /* 버튼 및 뱃지 스타일 */
                .badge-type { background-color: var(--accent-bg); color: #1565c0; padding: 4px 10px; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: bold; display: inline-block; }
                .btn-sale { padding: 6px 12px; background-color: var(--success-bg); color: var(--success); border: 1px solid var(--success); border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.2s; }
                .btn-soldout { padding: 6px 12px; background-color: var(--danger-bg); color: #c62828; border: 1px solid #c62828; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.2s; }
                .btn-action { padding: 6px 12px; border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: background-color 0.2s; }
                .btn-edit { background-color: var(--warning); color: white; margin-right: 5px; }
                .btn-del { background-color: var(--danger); color: white; }

                /* 다크모드 오버라이드 */
                [data-theme='dark'] .badge-type { background-color: rgba(21, 101, 192, 0.2); color: #64b5f6; }
                [data-theme='dark'] .btn-sale { background-color: rgba(46, 125, 50, 0.1); border-color: #4caf50; color: #81c784; }
                [data-theme='dark'] .btn-soldout { background-color: rgba(220, 53, 69, 0.1); border-color: #ff5252; color: #ff8a80; }
                [data-theme='dark'] .btn-edit { background-color: rgba(255, 152, 0, 0.2); color: #ffb74d; }
                [data-theme='dark'] .btn-del { background-color: rgba(220, 53, 69, 0.2); color: #ff8a80; }

                /* 모바일 반응형 */
                @media (max-width: 768px) {
                    .menu-container { padding: 15px; }
                    .menu-header {
                                            /* 세로로 쌓으면 고정 바가 화면을 계속 차지한다. 한 줄로 유지. */
                                            flex-direction: row; align-items: center; gap: 8px;
                                            margin: -15px -15px 16px -15px; padding: 10px 15px;
                                        }
                    .header-left { width: 100%; }
                    /* 헤더가 한 줄 flex로 유지되므로 absolute로 띄울 필요가 없다.
                       띄워두면 sticky 헤더의 padding 위로 올라가 잘린다. */
                    .theme-wrapper { position: static; flex-shrink: 0; }
                    
                    /* 모바일은 카드 뷰라 내부 스크롤이 필요 없다. 페이지 전체 스크롤로 되돌린다. */
                    .menu-container { height: auto; min-height: 100dvh; }
                    .menu-content { flex-direction: column; flex: none; min-height: 0; } 
                    .form-section { width: 100%; align-self: stretch; max-height: none; overflow: visible; } 
                    .list-section { display: block; }
                    .menu-table-scroll { overflow: visible; } 
                    /* 모바일에서는 이 영역이 배경 없는 통로 역할만 한다(카드 외형은 각 .menu-card가 갖는다).
                       라운딩과 overflow: hidden을 남겨두면 패딩이 0이라 모서리 곡선이 첫 줄 첫 글자를 잘라먹는다. */
                    .list-section { padding: 0; background-color: transparent; box-shadow: none; border: none; border-radius: 0; overflow: visible; } 
                    
                    .menu-table-view { display: none; } 
                    .menu-card-view { display: flex; flex-direction: column; gap: 15px; } 
                    
                    /* 모바일 카드 뷰 */
                    .menu-card { background-color: var(--card-bg, white); border-radius: var(--radius-lg); padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border-color, #eee); }
                    .menu-card.dragging {
                        position: relative; z-index: 5;
                        box-shadow: 0 10px 24px rgba(0,0,0,.22);
                        cursor: grabbing;
                    }
                    /* 카드에서는 손잡이를 제목 왼쪽에 둔다. 제목·배지와 한 줄을 나눠 쓴다. */
                    .menu-card-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
                    .menu-card-title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
                    .menu-card-title { font-size: 1.1rem; font-weight: bold; color: var(--text-primary, #333); }
                    .menu-card-price { font-size: 1.05rem; color: var(--text-primary, #555); margin-top: 5px; }
                    .menu-card-actions { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color, #eee); padding-top: 12px; margin-top: 5px; }
                }
                `}
            </style>

            {/* 헤더 */}
            <div className="menu-header">
                <div className="header-left">
                    <Button variant="neutral" icon="⬅" onClick={onBack}>
                        뒤로
                    </Button>
                    <h1 className="menu-title">📋 메뉴 관리</h1>
                </div>
                <div className="theme-wrapper">
                    <ThemeToggle />
                </div>
            </div>

            <div className="menu-content">
                {/* 1. 입력 폼 섹션 (추가/수정) */}
                <Card className="form-section">
                    <h3 className="form-title">{editingId ? '✏️ 메뉴 수정' : '➕ 메뉴 추가'}</h3>
                    <form
                        onSubmit={
                            editingId
                                ? (e) => {
                                      e.preventDefault();
                                      void handleUpdate();
                                  }
                                : handleAdd
                        }
                    >
                        <input
                            name="name"
                            placeholder="메뉴 이름 (예: 카페라떼)"
                            value={formData.name}
                            onChange={handleInputChange}
                            className="menu-input"
                            required
                        />
                        <input
                            name="price"
                            type="number"
                            placeholder="가격 (예: 3000)"
                            value={formData.price}
                            onChange={handleInputChange}
                            className="menu-input"
                            required
                        />
                        <select name="type" value={formData.type} onChange={handleInputChange} className="menu-input">
                            {MENU_CATEGORIES.map((c) => (
                                <option key={c.type} value={c.type}>
                                    {c.label}
                                </option>
                            ))}
                        </select>

                        <Button type="submit" full variant={editingId ? 'warning' : 'primary'}>
                            {editingId ? '수정 완료' : '추가하기'}
                        </Button>
                        {editingId && (
                            <Button
                                type="button"
                                variant="neutral"
                                full
                                style={{ marginTop: 8 }}
                                onClick={() => {
                                    setEditingId(null);
                                    setFormData({ name: '', price: '', type: 'coffee' });
                                }}
                            >
                                취소
                            </Button>
                        )}
                    </form>
                </Card>

                {/* 2. 메뉴 리스트 섹션 */}
                <Card className="list-section">
                    <p className="menu-hint">⠿ 를 끌어 순서를 바꾸면 캐셔 화면의 메뉴 차례도 같이 바뀝니다.</p>
                    {/* PC 테이블 뷰 — 머리글은 제자리에 두고 본문만 스크롤한다 */}
                    <div className="menu-table-scroll">
                        <table className="menu-table-view">
                            <thead>
                                <tr>
                                    <th className="col-grip" aria-label="순서" />
                                    <th>이름</th>
                                    <th>가격</th>
                                    <th>분류</th>
                                    <th>상태 변경</th>
                                    <th>관리</th>
                                </tr>
                            </thead>
                            <tbody data-drag-list>
                                {menuList.map((menu, idx) => (
                                    <tr
                                        key={menu.id}
                                        data-drag-row
                                        data-drag-id={menu.id}
                                        className={dragId === menu.id ? 'dragging' : ''}
                                    >
                                        <td
                                            className="menu-grip"
                                            onPointerDown={(e) => dragStart(e, idx, menu.id)}
                                            aria-label="끌어서 순서 변경"
                                        >
                                            ⠿
                                        </td>
                                        <td>
                                            <strong>{menu.name}</strong>
                                        </td>
                                        <td>{menu.price.toLocaleString()}원</td>
                                        <td>
                                            <span className="badge-type">{categoryLabel(menu.type)}</span>
                                        </td>
                                        <td>
                                            <button
                                                onClick={() => toggleSoldOut(menu)}
                                                className={menu.is_soldout ? 'btn-soldout' : 'btn-sale'}
                                            >
                                                {menu.is_soldout ? '🚫 품절' : '🟢 판매중'}
                                            </button>
                                        </td>
                                        <td>
                                            <button onClick={() => startEdit(menu)} className="btn-action btn-edit">
                                                수정
                                            </button>
                                            <button
                                                onClick={() => handleDelete(menu.id)}
                                                className="btn-action btn-del"
                                            >
                                                삭제
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* 모바일 카드 뷰 */}
                    <div className="menu-card-view" data-drag-list>
                        {menuList.map((menu, idx) => (
                            <div
                                key={menu.id}
                                data-drag-row
                                data-drag-id={menu.id}
                                className={`menu-card ${dragId === menu.id ? 'dragging' : ''}`}
                            >
                                <div>
                                    <div className="menu-card-header">
                                        <div className="menu-card-title-wrap">
                                            <span
                                                className="menu-grip"
                                                onPointerDown={(e) => dragStart(e, idx, menu.id)}
                                                aria-label="끌어서 순서 변경"
                                            >
                                                ⠿
                                            </span>
                                            <div className="menu-card-title">{menu.name}</div>
                                        </div>
                                        <span className="badge-type">{categoryLabel(menu.type)}</span>
                                    </div>
                                    <div className="menu-card-price">{menu.price.toLocaleString()}원</div>
                                </div>
                                <div className="menu-card-actions">
                                    <button
                                        onClick={() => toggleSoldOut(menu)}
                                        className={menu.is_soldout ? 'btn-soldout' : 'btn-sale'}
                                    >
                                        {menu.is_soldout ? '🚫 품절중' : '🟢 판매중'}
                                    </button>
                                    <div>
                                        <button onClick={() => startEdit(menu)} className="btn-action btn-edit">
                                            수정
                                        </button>
                                        <button onClick={() => handleDelete(menu.id)} className="btn-action btn-del">
                                            삭제
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}

export default MenuDashboard;
