import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRun, parseCron } from '../src/cron/cron.ts';

const at = (s: string) => new Date(s);
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('expressions courantes', () => {
  assert.equal(fmt(nextRun('*/15 * * * *', at('2026-11-03T10:07:00'))), '2026-11-03 10:15');
  assert.equal(fmt(nextRun('30 7 * * 1-5', at('2026-11-06T08:00:00'))), '2026-11-09 07:30'); // vendredi → lundi
  assert.equal(fmt(nextRun('0 9 1 * *', at('2026-11-03T10:00:00'))), '2026-12-01 09:00');
  assert.equal(fmt(nextRun('@daily', at('2026-12-31T23:59:00'))), '2027-01-01 00:00');
  assert.equal(fmt(nextRun('0 12 * * 7', at('2026-11-03T00:00:00'))), '2026-11-08 12:00'); // 7 = dimanche
});

test('toujours strictement dans le futur', () => {
  assert.equal(fmt(nextRun('0 10 * * *', at('2026-11-03T10:00:00'))), '2026-11-04 10:00');
});

test('expressions invalides refusées', () => {
  for (const e of ['* * *', '61 * * * *', '* 24 * * *', '*/0 * * * *', 'abc * * * *']) assert.throws(() => parseCron(e), e);
});
