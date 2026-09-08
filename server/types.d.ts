// 에디터 타입 검사(checkJs) 전용 선언 파일 — 런타임에는 사용되지 않는다.
// Express Request에 미들웨어가 심어 넣는 커스텀 프로퍼티를 알려준다.
import 'express';

/** authenticateToken이 검증한 JWT 페이로드 */
export interface JwtUser {
    /** users.id는 varchar(36) UUID다. 숫자가 아니다. */
    id: string;
    username: string;
    name: string;
    role: 'admin' | 'staff' | 'pending';
    iat?: number;
    exp?: number;
}

declare module 'express-serve-static-core' {
    interface Request {
        // authenticateToken 통과 뒤에만 존재하지만, 보호된 라우트에서는 항상 채워져 있으므로
        // 매 접근마다 옵셔널 체이닝을 강요하지 않도록 필수로 선언한다.
        user: JwtUser;
        /** loginRateLimiter가 기록하는 IP 기반 시도 키 */
        loginKey?: string;
    }
}
