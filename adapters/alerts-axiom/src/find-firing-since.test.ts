import { expect, test } from 'bun:test';
import { findFiringSince } from './find-firing-since.ts';

test('it gives the newest timestamp when the newest notification is open, whatever the order', () => {
  const since = findFiringSince([
    { timestamp: '2026-11-17T08:00:00Z', state: 'closed' },
    { timestamp: '2026-11-17T09:00:00Z', state: 'open' },
    { timestamp: '2026-11-17T07:00:00Z', state: 'open' },
  ]);

  expect(since).toBe('2026-11-17T09:00:00Z');
});

test('it gives null when the newest notification is closed', () => {
  const since = findFiringSince([
    { timestamp: '2026-11-17T09:00:00Z', state: 'closed' },
    { timestamp: '2026-11-17T08:00:00Z', state: 'open' },
  ]);

  expect(since).toBeNull();
});

test('it counts the monitor open when an open and a closed notification share the newest time', () => {
  const since = findFiringSince([
    { timestamp: '2026-11-17T09:00:00Z', state: 'closed' },
    { timestamp: '2026-11-17T10:00:00+01:00', state: 'open' },
  ]);

  expect(since).toBe('2026-11-17T10:00:00+01:00');
});

test('it gives null for a monitor with no notification in the window', () => {
  expect(findFiringSince([])).toBeNull();
});
