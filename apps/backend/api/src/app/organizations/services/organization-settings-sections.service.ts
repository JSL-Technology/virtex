import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrganizationSettings } from '../entities/organization-settings.entity';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';
import { OrgSettingsService } from './org-settings.service';
import { SETTINGS_SECTIONS, SettingsSectionId, isSettingsSection } from './settings-sections';

/** An account as a settings screen shows it: enough to name it, never its balance. */
export interface SettingsAccountRef {
  id: string;
  code: string;
  name: Record<string, string> | string;
  type: string;
}

export interface SettingsSectionView {
  section: SettingsSectionId;
  accounts: Record<string, SettingsAccountRef | null>;
  /** The type each account field expects, so the picker can offer only those (null: any). */
  expectedTypes: Record<string, string | null>;
  fields: Record<string, unknown>;
  /** Currencies only: the books' currency, and whether it can still change. */
  baseCurrency?: { code: string; locked: boolean };
}

export interface SettingsSectionPatch {
  accounts?: Record<string, string | null>;
  fields?: Record<string, unknown>;
  baseCurrency?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read and change one section of the organization's settings (QA M-09). */
@Injectable()
export class OrganizationSettingsSectionsService {
  constructor(
    @InjectRepository(OrganizationSettings) private readonly repo: Repository<OrganizationSettings>,
    private readonly settings: OrgSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  async get(sectionId: string, organizationId: string): Promise<SettingsSectionView> {
    const section = this.section(sectionId);
    const row = await this.row(organizationId);
    const definition = SETTINGS_SECTIONS[section];

    const ids = Object.keys(definition.accounts)
      .map((field) => (row as unknown as Record<string, string | null>)[field])
      .filter((id): id is string => !!id);
    const found = await this.accountsById(organizationId, ids);

    const accounts: Record<string, SettingsAccountRef | null> = {};
    for (const field of Object.keys(definition.accounts)) {
      const id = (row as unknown as Record<string, string | null>)[field];
      accounts[field] = id ? (found.get(id) ?? null) : null;
    }
    const fields: Record<string, unknown> = {};
    for (const field of Object.keys(definition.fields)) {
      fields[field] = (row as unknown as Record<string, unknown>)[field] ?? null;
    }

    return {
      section,
      accounts,
      expectedTypes: { ...definition.accounts },
      fields,
      ...(section === 'currencies'
        ? { baseCurrency: { code: row.baseCurrency, locked: await this.hasBooks(organizationId) } }
        : {}),
    };
  }

  async update(sectionId: string, organizationId: string, patch: SettingsSectionPatch): Promise<SettingsSectionView> {
    const section = this.section(sectionId);
    const definition = SETTINGS_SECTIONS[section];
    const changes: Partial<Record<string, unknown>> = {};

    // Accounts: each must belong to this tenant, take postings, and be of the type its role needs.
    const requested = Object.entries(patch.accounts ?? {});
    for (const [field] of requested) {
      if (!(field in definition.accounts)) {
        throw new BadRequestError('organizations.settings.unknown_field', { field, section });
      }
    }
    const ids = requested.map(([, id]) => id).filter((id): id is string => !!id);
    for (const [field, id] of requested) {
      if (id !== null && (typeof id !== 'string' || !UUID.test(id))) {
        throw new BadRequestError('organizations.settings.account_not_usable', { field });
      }
    }
    const found = await this.accountsById(organizationId, ids, true);
    for (const [field, id] of requested) {
      if (id === null) {
        changes[field] = null;
        continue;
      }
      const account = found.get(id);
      if (!account) throw new BadRequestError('organizations.settings.account_not_usable', { field });
      const expected = (definition.accounts as Record<string, string | null>)[field];
      if (expected && account.type !== expected) {
        throw new BadRequestError('organizations.settings.account_wrong_type', {
          field,
          code: account.code,
          expected,
          actual: account.type,
        });
      }
      changes[field] = id;
    }

    // Policies: each with its own rule.
    for (const [field, value] of Object.entries(patch.fields ?? {})) {
      const rule = (definition.fields as Record<string, { validate: (v: unknown) => { ok: boolean; value?: unknown; key?: string; params?: Record<string, unknown> } }>)[field];
      if (!rule) throw new BadRequestError('organizations.settings.unknown_field', { field, section });
      const result = rule.validate(value);
      if (!result.ok) throw new BadRequestError(result.key as string, { field, ...(result.params ?? {}) });
      changes[field] = result.value;
    }

    // The books' currency, only before there are books: every posted amount is in it.
    if (patch.baseCurrency !== undefined) {
      if (section !== 'currencies') throw new BadRequestError('organizations.settings.unknown_field', { field: 'baseCurrency', section });
      const code = String(patch.baseCurrency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestError('organizations.settings.currency_code');
      const row = await this.row(organizationId);
      if (code !== row.baseCurrency) {
        if (await this.hasBooks(organizationId)) throw new BadRequestError('organizations.settings.base_currency_locked');
        changes['baseCurrency'] = code;
      }
    }

    if (Object.keys(changes).length > 0) {
      await this.settings.update(organizationId, changes as Partial<OrganizationSettings>);
    }
    return this.get(section, organizationId);
  }

  private section(id: string): SettingsSectionId {
    if (!isSettingsSection(id)) throw new NotFoundError('organizations.settings.unknown_section', { section: id });
    return id;
  }

  private async row(organizationId: string): Promise<OrganizationSettings> {
    const row = await this.repo.findOne({ where: { organizationId } });
    if (!row) throw new NotFoundError('organizations.settings.not_found');
    return row;
  }

  private async hasBooks(organizationId: string): Promise<boolean> {
    const [{ exists }] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM journal_entries WHERE organization_id = $1) AS exists`,
      [organizationId],
    );
    return Boolean(exists);
  }

  /** Accounts of this tenant; with `usable`, only active ones that take postings. */
  private async accountsById(
    organizationId: string,
    ids: string[],
    usable = false,
  ): Promise<Map<string, SettingsAccountRef>> {
    if (ids.length === 0) return new Map();
    const rows: SettingsAccountRef[] = await this.dataSource.query(
      `SELECT id, code, name, type::text AS type
         FROM accounts
        WHERE organization_id = $1 AND id = ANY($2::uuid[])
          ${usable ? 'AND "isActive" = true AND "isPostable" = true' : ''}`,
      [organizationId, ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }
}
