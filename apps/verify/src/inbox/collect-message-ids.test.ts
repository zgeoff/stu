import { expect, test } from 'bun:test';
import { collectMessageIDs } from './collect-message-ids.ts';

test('it collects each message id once, in the order the events first name it', () => {
  const events = [
    { message: 'm-plum' },
    {},
    { message: 'm-fig' },
    { message: 'm-plum' },
    { message: 'm-kiwi' },
  ];

  expect(collectMessageIDs(events)).toStrictEqual(['m-plum', 'm-fig', 'm-kiwi']);
});

test('it collects nothing from events that name no message', () => {
  expect(collectMessageIDs([{}, {}])).toStrictEqual([]);
});
