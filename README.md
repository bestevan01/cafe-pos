# Cafe POS 시스템 | Baek's Coffee

Baek's Coffee(백석대학교 본부동 1층, 기부 연계 카페) 운영을 위한 웹 기반 POS(주문·정산·통계) 시스템입니다.

## 주요 기능

### 주문 (POS)

- 캐셔 / 주방 / 1인 모드(캐셔+주방 겸용) 역할 선택
- 실시간 주문 접수·조리완료·전달·결제 처리 (Socket.IO)
- 커피 잔별 샷 추가 등 옵션 처리
- 이벤트(무료/정액 할인) 적용, 메뉴별·일일 한정 수량 처리

### 관리자 대시보드

- 📊 매출 통계 (기간별 조회, 엑셀 내보내기, 고급 통계)
- 💰 시재 정산 (오픈/마감 시재 계산)
- 📋 메뉴 관리 (추가/수정/삭제/품절 처리)
- 🧮 원가 분석 (재료·레시피 기반 메뉴 원가/마진 계산)
- 🎉 이벤트 관리 (무료/할인 이벤트 생성 및 노출 제어)
- 👥 직원 관리 (권한 변경, 계정 삭제)

### 인증 및 계정

- JWT 기반 로그인 + WebAuthn 패스키(생체인증/보안키) 로그인
- 역할: `admin`(관리자) / `staff`(직원) / `pending`(승인 대기)
- 내 정보 화면에서 비밀번호 변경, 패스키 등록·이름 변경·삭제

## 기술 스택

**클라이언트** (`client/`)

- React 19 + Vite 8(Rolldown)
- Socket.IO Client, Axios, Framer Motion
- 라우팅 없이 React state 기반 화면 전환

**서버** (`server/`)

- Express 5 + Socket.IO
- MySQL / TiDB (mysql2)
- JWT 인증, `@simplewebauthn/server` (WebAuthn 패스키)

### 배포 환경

- 프론트엔드: Vercel
- 백엔드: Render (GitHub Actions cron으로 슬립 방지)

## 프로젝트 구조

```text
.
├── client/          # React + Vite 프론트엔드
├── server/          # Express + Socket.IO 백엔드
├── vercel.json       # 루트 vercel.json으로 client/ 빌드 지정
└── .github/workflows/ # Render 서버 슬립 방지 cron
```

## 시작하기

### 사전 준비

- Node.js, MySQL(또는 TiDB) 인스턴스

### 서버 (`server/`)

```bash
cd server
npm install
```

`server/.env` 파일 생성 후 아래 값 설정:

```env
JWT_SECRET=
PORT=8080
DB_HOST=
DB_USER=
DB_PASSWORD=
DB_NAME=
DB_PORT=
```

```bash
npm run dev   # nodemon으로 개발 서버 실행 (localhost:8080)
```

### 클라이언트 (`client/`)

```bash
cd client
npm install
npm run dev   # Vite 개발 서버 (localhost:5173, /api·/socket.io는 8080으로 프록시)
```

### 동시 실행 (VS Code)

`.vscode/tasks.json`에 `client: dev` / `server: dev` / `dev: client + server` 태스크가 정의되어 있어, VS Code에서 `⌘⇧B`(빌드 실행) 한 번으로 둘 다 켤 수 있습니다. (Task Buttons 확장을 설치하면 상태표시줄에 실행 버튼도 표시됩니다.)

## 개발 환경

- **ESLint**: `client/eslint.config.js` (flat config, React Hooks 규칙 포함)
- **Prettier**: 루트 `.prettierrc` — `npm run format` / `npm run format:check`

## 배포

- 프론트엔드: 루트 `vercel.json`이 `client/` 디렉터리를 빌드(대시보드 Root Directory 설정 대신 사용)
- 백엔드: Render (Root Directory = `server`), `/ping`으로 헬스체크
