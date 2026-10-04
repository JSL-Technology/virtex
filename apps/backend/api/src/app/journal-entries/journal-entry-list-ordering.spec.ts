import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JournalEntryListQueryDto } from './dto/journal-entry-list-query.dto';

/** QA B-01: the journal-entry list is ordered by the server, by validated columns only. */
describe('Journal-entry list ordering', () => {
  it('accepts only known journal-entry columns and directions', async () => {
    const ok = plainToInstance(JournalEntryListQueryDto, { sort: 'entryNumber', direction: 'desc', page: '2' });
    expect(await validate(ok)).toHaveLength(0);
    const bad = plainToInstance(JournalEntryListQueryDto, { sort: 'lines', direction: 'sideways' });
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual(['direction', 'sort']);
  });});
