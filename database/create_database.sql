-- 音楽アプリ用データベースの作成
CREATE DATABASE IF NOT EXISTS sound_library_cloud 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE sound_library_cloud;

-- 部屋（Room）テーブル
CREATE TABLE rooms (
  id INT PRIMARY KEY AUTO_INCREMENT,
  room_number INT UNIQUE NOT NULL,
  room_name VARCHAR(255) NOT NULL DEFAULT 'Room',
  teacher_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 音声ファイルテーブル
CREATE TABLE audio_files (
  id INT PRIMARY KEY AUTO_INCREMENT,
  uid VARCHAR(255) UNIQUE NOT NULL,
  room_id INT NOT NULL,
  student_name VARCHAR(255),
  file_name VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INT,
  duration DECIMAL(10,2),
  mime_type VARCHAR(100),
  tags JSON,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  download_count INT DEFAULT 0,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- 曲データテーブル（DAWで作成された楽曲）
CREATE TABLE song_data (
  id INT PRIMARY KEY AUTO_INCREMENT,
  uid VARCHAR(255) UNIQUE NOT NULL,
  room_id INT NOT NULL,
  student_name VARCHAR(255),
  group_number VARCHAR(50),
  song_title VARCHAR(255) NOT NULL,
  song_data JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- ダウンロード履歴テーブル（重複ダウンロード防止）
CREATE TABLE download_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  audio_uid VARCHAR(255) NOT NULL,
  user_identifier VARCHAR(255) NOT NULL,
  downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_download (audio_uid, user_identifier),
  FOREIGN KEY (audio_uid) REFERENCES audio_files(uid) ON DELETE CASCADE
);

-- インデックスの作成（パフォーマンス向上のため）
CREATE INDEX idx_rooms_number ON rooms(room_number);
CREATE INDEX idx_audio_room ON audio_files(room_id);
CREATE INDEX idx_audio_tags ON audio_files(tags);
CREATE INDEX idx_song_room ON song_data(room_id);
CREATE INDEX idx_song_group ON song_data(group_number);

-- 初期データの挿入（テスト用）
INSERT INTO rooms (room_number, room_name, teacher_name) VALUES 
(101, '1年1組', '田中先生'),
(102, '1年2組', '佐藤先生'),
(201, '2年1組', '鈴木先生');
