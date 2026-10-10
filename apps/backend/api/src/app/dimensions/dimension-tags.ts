import { EntityManager, In } from 'typeorm';
import { Dimension } from './entities/dimension.entity';
import { BadRequestError } from '../i18n/localized.exception';

/**
 * The dimension tags on a set of journal lines, checked against the tenant's dimensions: every
 * key a dimension that exists and is active, every value one of its active values.
 *
 * Nothing checked them. A line could carry `{"Centro de Costo": "VNTAS"}` — a typo — and the cost
 * fell out of every analytical report, the budget control and the variance analysis, which match
 * the value exactly. SAP, NetSuite and Odoo all refuse a segment value that is not in the list.
 *
 * Returns the tags trimmed, with empty values dropped, in the shape they are stored.
 */
export async function normaliseDimensionTags(
  manager: EntityManager,
  organizationId: string,
  lines: ReadonlyArray<{ dimensions?: Record<string, string> | null }>,
): Promise<Array<Record<string, string> | undefined>> {
  const normalised = lines.map((line) => {
    const entries = Object.entries(line.dimensions ?? {})
      .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()] as const)
      .filter(([key, value]) => key && value);
    return entries.length ? Object.fromEntries(entries) : undefined;
  });

  const names = [...new Set(normalised.flatMap((tags) => Object.keys(tags ?? {})))];
  if (names.length === 0) return normalised;

  const dimensions = await manager.find(Dimension, {
    where: { organizationId, name: In(names) },
    relations: ['values'],
  });
  const byName = new Map(dimensions.map((dimension) => [dimension.name, dimension]));

  for (const tags of normalised) {
    for (const [name, value] of Object.entries(tags ?? {})) {
      const dimension = byName.get(name);
      if (!dimension) throw new BadRequestError('journal_entries.unknown_dimension', { dimension: name });
      if (!dimension.isActive) throw new BadRequestError('journal_entries.inactive_dimension', { dimension: name });
      const known = dimension.values?.find((candidate) => candidate.value === value);
      if (!known) throw new BadRequestError('journal_entries.unknown_dimension_value', { dimension: name, value });
      if (!known.isActive) throw new BadRequestError('journal_entries.inactive_dimension_value', { dimension: name, value });
    }
  }
  return normalised;
}
