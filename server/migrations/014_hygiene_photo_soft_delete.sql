-- 제출된 점검에 붙은 사진은 지워도 실제로 지우지 않는다.
--
-- 지금까지는 ✕를 누르면 R2 객체와 DB 행을 모두 없앴다. 아직 어느 점검에도 안 붙은 사진이라면
-- 그게 맞다 — 잘못 올린 파일이고, 그냥 두면 R2에 고아 객체만 남는다.
--
-- 그런데 이미 제출된 점검에 붙은 사진은 다르다. 그건 감사 기록의 일부다.
-- 미흡 항목의 증거 사진을 지우고 상태를 '양호'로 고치면 기록상 아무 일도 없었던 것이 된다.
-- 수정 이력에 '사진 1장 삭제'라고만 남아서는, 무엇이 지워졌는지 확인할 방법이 없다.
-- 사유·특이사항의 변경 전 글을 그대로 남기기로 한 것과 같은 이유다(013 참고).
--
-- 그래서 status를 'removed'로 바꾸고 누가 언제 지웠는지를 이 행에 새긴다. R2 객체는 그대로 둔다.
--   - 직원 화면은 status='ready'만 읽으므로 지운 사진은 사라진 것처럼 보인다(의도한 동작).
--   - 관리자 화면은 'removed'까지 읽어 '삭제됨 · 누가 · 언제'를 붙여 함께 보여준다.
--
-- 보관 기간은 그대로 R2 Lifecycle(730일)이 담당한다. 지운 사진을 더 일찍 없애지 않는다 —
-- 감사 기록의 보관 기간이 '누가 지웠는가'에 따라 달라지면 그게 더 이상하다.
--
-- 되돌리기(복구) 기능은 만들지 않았다. 필요해지면 status를 'ready'로 되돌리고
-- removed_* 를 비우면 되지만, 그 조작 자체도 이력에 남아야 하므로 따로 설계해야 한다.

ALTER TABLE hygiene_check_photos
    ADD COLUMN removed_at      DATETIME    NULL AFTER created_at,
    ADD COLUMN removed_by_id   VARCHAR(36) NULL AFTER removed_at,   -- users.id. FK를 걸지 않는다(계정을 지워도 기록은 남는다)
    ADD COLUMN removed_by_name VARCHAR(50) NULL AFTER removed_by_id; -- 이름 스냅샷. checked_by_name과 같은 방식

-- status는 VARCHAR(10)이라 'removed'(7자)가 그대로 들어간다. 값 목록만 늘어난다:
--   pending | ready | removed
