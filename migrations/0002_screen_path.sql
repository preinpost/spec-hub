-- 화면 경로와 접근 경로는 선택 항목이며, 기존 기능과 확정본은 NULL 을 유지한다.
ALTER TABLE features ADD COLUMN screen_path TEXT;
ALTER TABLE feature_snapshots ADD COLUMN screen_path TEXT;
ALTER TABLE features ADD COLUMN entry_path TEXT;
ALTER TABLE feature_snapshots ADD COLUMN entry_path TEXT;
