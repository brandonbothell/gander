import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const dbPath = path.join(__dirname, '../security-cam.sqlite'); // Adjust if your DB is elsewhere

function parseRecordedAt(filename: string, fallback: string): string {
  // Example: motion_2025-06-02T21-17-12-096Z.mp4
  const match = filename.match(/^motion_(\d{4}-\d{2}-\d{2})T/);
  if (!match) return fallback.slice(0, 10); // fallback to YYYY-MM-DD from updatedAt
  return match[1];
}

async function main() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // 1. Add the column if it doesn't exist
  await db.exec(`ALTER TABLE MotionRecording ADD COLUMN recordedAt TEXT`);

  // 2. Get all rows
  const rows = await db.all(`SELECT streamId, filename, updatedAt FROM MotionRecording`);

  for (const row of rows) {
    const fallback = row.updatedAt || new Date().toISOString();
    const recordedAt = parseRecordedAt(row.filename, fallback);
    await db.run(
      `UPDATE MotionRecording SET recordedAt = ? WHERE streamId = ? AND filename = ?`,
      recordedAt,
      row.streamId,
      row.filename
    );
    console.log(`Updated ${row.filename}: recordedAt = ${recordedAt}`);
  }

  await db.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
