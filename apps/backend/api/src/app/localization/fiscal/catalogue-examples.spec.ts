import { IDENTITY_DOCUMENT_TYPES } from './identity-document-catalogue';
import { resolveChecksum } from './document-checksums';

/**
 * Every example the catalogue shows a user is one the catalogue accepts.
 *
 * The cédula's example, «001-1234567-8», failed its own check digit: the employee form showed it
 * as the placeholder, and a user who typed it in the shape suggested got 422 (QA M-15). An example
 * is a promise about the format; this keeps it.
 */
describe('identity document catalogue examples', () => {
  const withExamples = IDENTITY_DOCUMENT_TYPES.filter((spec) => !!spec.example);

  it.each(withExamples.map((spec) => [`${spec.countryCode}/${spec.code}`, spec] as const))(
    '%s: the example matches its own pattern and checksum',
    (_label, spec) => {
      const example = spec.example as string;
      if (spec.pattern) expect(new RegExp(spec.pattern).test(example)).toBe(true);
      const checksum = resolveChecksum(spec.checksum ?? null);
      if (checksum) expect(checksum(example)).toBe(true);
    },
  );
});
