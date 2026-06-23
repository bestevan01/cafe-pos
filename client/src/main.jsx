import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import {NotificationProvider} from './components/NotificationProvider'

axios.defaults.baseURL = import.meta.env['VITE_API_URL'] || 'http://localhost:8080';
// 콜드 스타트(최대 ~60초)는 통과시키되, 진짜 죽은 서버에선 무한 대기하지 않도록 상한선
axios.defaults.timeout = 90000;

// 앱이 열리는 즉시 백그라운드로 서버를 깨운다(예열). 사용자가 로그인 입력하는 동안 미리 기동.
axios.get('/ping').catch(() => {
});

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <NotificationProvider>
            <App/>
        </NotificationProvider>
    </StrictMode>,
)
