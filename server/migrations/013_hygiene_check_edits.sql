-- 위생 점검 기록의 수정 이력.
--
-- 같은 날이면 점검 기록을 고칠 수 있는데, 지금은 결과를 통째로 지우고 다시 쓴다.
-- 그래서 이전 답변이 사라지고 updated_at만 바뀔 뿐, 누가 무엇을 고쳤는지 남지 않았다.
-- 김서연이 '미흡'으로 낸 것을 곽두팔이 '양호'로 바꿔도 기록에는 김서연·양호만 보인다.
--
-- 위생 점검은 감사 목적이라 그러면 안 된다. 항목 문구를 결과 행에 복사해 두는 것도
-- 같은 이유였다(관리자가 항목을 고쳐도 과거 기록은 그대로여야 한다).
-- 고치는 것 자체는 막지 않되, 고친 사실이 남게 한다.
--
-- changes에 JSON을 넣는 이유: 무엇이 어떻게 바뀌었는지는 항목마다 다르고 개수도 들쭉날쭉해서
-- 컬럼으로 펴기 어렵다. 조회는 '이 점검의 이력 전부'뿐이라 검색 성능이 필요 없다.
--
-- 사유·특이사항은 '바뀌었다'가 아니라 바뀌기 전후의 글을 그대로 담는다. 결과 행은 수정할 때
-- 통째로 지워지므로, 여기 남기지 않으면 무엇이 어떻게 고쳐졌는지 확인할 방법이 사라진다.
-- 둘 다 VARCHAR(500)이라 원문을 담아도 부담이 없다.
--
-- 형태: {"items":[{"label":"...","from":"ok","to":"fail","noteFrom":"...","noteTo":"..."}],
--        "memoChanged":true,"memoFrom":"...","memoTo":"...",
--        "photos":{"added":1,"removed":0},
--        "removedPhotos":[{"id":12,"label":"..."}]}
--
-- removedPhotos는 사진을 지운 이력에만 있다(014 참고). 사진 삭제는 저장할 때가 아니라
-- ✕를 누른 순간 처리되므로, 그 이력은 DELETE /uploads/:id가 따로 남긴다.

CREATE TABLE IF NOT EXISTS hygiene_check_edits
(
    id             INT AUTO_INCREMENT PRIMARY KEY,
    check_id       INT         NOT NULL,
    edited_by_id   VARCHAR(36) NULL,                              -- users.id. FK를 걸지 않는다(계정을 지워도 이력은 남아야 한다)
    edited_by_name VARCHAR(50) NOT NULL,                          -- 이름 스냅샷. checked_by_name과 같은 방식
    edited_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changes        TEXT        NOT NULL,                          -- 위 형태의 JSON
    CONSTRAINT fk_hygiene_edit_check FOREIGN KEY (check_id) REFERENCES hygiene_checks (id) ON DELETE CASCADE,
    KEY idx_hygiene_edits_check (check_id, edited_at)
);
