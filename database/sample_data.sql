-- 手元（XAMPP など）で試すときだけ使う部屋。本番のサーバーでは実行しない。
-- 先に database/create_database.sql を実行しておく。すでにある部屋番号は飛ばす。
USE sound_library_cloud;

INSERT IGNORE INTO rooms (room_number, room_name, teacher_name) VALUES
(101, '1年1組', '田中先生'),
(102, '1年2組', '佐藤先生'),
(201, '2年1組', '鈴木先生');
