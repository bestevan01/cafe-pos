import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import './index.css';
import App from './App.jsx';
import { NotificationProvider } from './components/NotificationProvider';
import { getStoreInfo } from './utils/storeInfo';

// 탭 제목에도 매장을 넣는다. 매장별 화면을 여러 탭에 띄워 두면 제목이 모두 같아 구분이 안 된다.
// 탭은 뒤쪽부터 잘리므로 매장명을 앞에 둔다. 화면 상단 띠와 같은 값을 쓰므로 둘이 어긋날 일이 없다.
// getStoreInfo()가 null이면(운영인데 VITE_STORE_NAME 미설정) index.html의 제목을 그대로 둔다 —
// 틀린 매장명을 띄우는 것보다 낫다.
const store = getStoreInfo();
if (store) document.title = `${store.label} | Baek's Cafe POS`;

axios.defaults.baseURL = import.meta.env['VITE_API_URL'] || 'http://localhost:8080';
// 콜드 스타트(최대 ~60초)는 통과시키되, 진짜 죽은 서버에선 무한 대기하지 않도록 상한선
axios.defaults.timeout = 90000;

// 앱이 열리는 즉시 백그라운드로 서버를 깨운다(예열). 사용자가 로그인 입력하는 동안 미리 기동.
axios.get('/ping').catch(() => {});

createRoot(/** @type {HTMLElement} */ (document.getElementById('root'))).render(
    <StrictMode>
        <NotificationProvider>
            <App />
        </NotificationProvider>
    </StrictMode>,
);
