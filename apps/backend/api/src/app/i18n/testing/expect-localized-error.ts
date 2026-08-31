import { isLocalizedError } from '../localized.exception';

/**
 * Assert on the KEY a failure names, not on the sentence it happens to render.
 *
 * The specs used to assert on the Spanish text — `.rejects.toThrow('Invalid 2FA token')`,
 * `.rejects.toThrow(/El número de segmentos proporcionados \(3\)/)` — which pinned the tests to
 * one language and made translating the product a test failure rather than a feature. Worse, the
 * assertion was on the *presentation*: a rewording that changed nothing about behaviour broke the
 * suite, and a change of meaning that kept the wording did not.
 *
 * The key and its parameters are the contract. The catalogue is checked separately, by
 * `messages.parity.spec.ts`, which is where wording belongs.
 *
 *     await expectLocalizedError(
 *       service.enableTwoFactor(user, '000000'),
 *       'AUTH.INVALID_2FA_TOKEN',
 *     );
 *
 *     await expectLocalizedError(
 *       service.create(dto, orgId, manager),
 *       'CHART_OF_ACCOUNTS.…_ORGANIZACION',
 *       { length: 3, length2: 2 },
 *     );
 */
export async function expectLocalizedError(
  promise: Promise<unknown>,
  messageKey: string,
  params?: Record<string, unknown>,
): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(`Expected a LocalizedError with key "${messageKey}", but nothing was thrown.`);
  }

  if (!isLocalizedError(thrown)) {
    throw new Error(
      `Expected a LocalizedError with key "${messageKey}", but got ` +
        `${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}.`,
    );
  }

  expect(thrown.messageKey).toBe(messageKey);
  if (params) expect(thrown.params).toMatchObject(params);
}
