import { Client } from 'pg';
import { z } from 'zod';
import { listVoiceTests, readVoiceTest } from '../backend/modules/ai/voice/history/report.ts';

const args = process.argv.slice(2);
const list = args.length === 0 || args[0] === '--limit';
const limit = args.length ? Number(args[1]) : 10;
const valid = list ? args.length <= 2 && Number.isInteger(limit) && limit >= 1 && limit <= 100
  : args.length === 1 && z.uuid().safeParse(args[0]).success;

if (!valid) {
  console.error('Gunakan npm run voice:history -- --limit 10 atau npm run voice:history -- <id-sesi>.');
  process.exitCode = 1;
} else if (!process.env.DATABASE_ADMIN_URL) {
  console.error('DATABASE_ADMIN_URL diperlukan di server untuk membaca riwayat uji.');
  process.exitCode = 1;
} else {
  const db = new Client({ connectionString: process.env.DATABASE_ADMIN_URL, connectionTimeoutMillis: 5_000 });
  try {
    await db.connect();
    const report = list ? await listVoiceTests(db, limit) : await readVoiceTest(db, args[0]);
    if (report === undefined) {
      console.error('Sesi uji tidak ditemukan.');
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch {
    console.error('Riwayat uji tidak dapat dibaca. Periksa koneksi database admin dan migrasinya.');
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
