-- ログインを Google アカウント (Better Auth) に切り替える
-- users.email と同じメールアドレスの Google アカウントでログインした人を、その従業員として扱う

-- パスワードは使わなくなる
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users DROP COLUMN must_change_password;

-- ───────────── Better Auth ─────────────
-- 列名は Better Auth の既定 (camelCase) のまま。日時は ISO 文字列 (UTC)、真偽値は 0/1 で入る
CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_session_userId_idx ON auth_session(userId);

CREATE TABLE IF NOT EXISTS auth_account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_account_userId_idx ON auth_account(userId);

-- OAuth の state など、一時的な値
CREATE TABLE IF NOT EXISTS auth_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON auth_verification(identifier);
