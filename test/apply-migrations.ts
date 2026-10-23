import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// 실제 마이그레이션 SQL 로 스키마를 만든다. 이미 적용한 마이그레이션은 건너뛴다.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
