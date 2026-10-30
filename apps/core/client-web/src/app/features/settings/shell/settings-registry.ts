import { Type } from '@angular/core';
import {
  BookOpenCheck,
  Building,
  Building2,
  CreditCard,
  Database,
  Hash,
  KeyRound,
  Landmark,
  Lock,
  LucideIconData,
  Mail,
  MapPin,
  MapPinned,
  Palette,
  Puzzle,
  ReceiptText,
  Scale,
  ScrollText,
  Server,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCircle,
  Users,
  Workflow,
  Languages,
} from 'lucide-angular';

/** Who a section's settings affect: the reader alone, the whole company, or how it is administered. */
export type SettingsScope = 'personal' | 'company' | 'admin';

export type SettingsGroupId = 'account' | 'company' | 'accounting' | 'operations' | 'admin';

export interface SettingsGroupDef {
  id: SettingsGroupId;
  labelKey: string;
}

export interface SettingsSectionDef {
  /** The id in `#settings/<id>`. Stable: links across the product point at it. */
  id: string;
  group: SettingsGroupId;
  /**
   * The section's name — in the sidebar AND as the page title. One key for both, so the two can
   * never disagree again (11 of 26 did: «Inventario» opened «Políticas de inventario»).
   */
  labelKey: string;
  /** One sentence under the title: what the section decides. */
  descriptionKey: string;
  icon: LucideIconData;
  scope: SettingsScope;
  /** Needed to see the section at all. Absent: every member. */
  viewPermission?: string;
  /** Needed to change it; without it the section is shown read only, and says why. Absent: = view. */
  editPermission?: string;
  /** Extra words people search the section by, comma-separated, as an i18n key. */
  keywordsKey?: string;
  /** Shown only for companies of these countries. */
  countries?: readonly string[];
  /** Hidden for companies of these countries. */
  exceptCountries?: readonly string[];
  /** Inputs for the section's component — one component may serve two sections. */
  inputs?: Record<string, unknown>;
  /** The component takes a `focus` input: the group to bring into view (old ids lead there). */
  focusable?: boolean;
  load: () => Promise<Type<unknown>>;
}

/**
 * The groups, in the order of how often they are needed: people and access come right after the
 * company, not at the foot of a 26-entry list under finance (CG-07).
 */
export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
  { id: 'account', labelKey: 'settings.groups.account' },
  { id: 'company', labelKey: 'settings.groups.company' },
  { id: 'admin', labelKey: 'settings.groups.admin' },
  { id: 'accounting', labelKey: 'settings.groups.accounting' },
  { id: 'operations', labelKey: 'settings.groups.operations' },
];

/**
 * Every settings section, in order — the one source the sidebar, the search, the page header,
 * the permissions and the deep links are drawn from.
 *
 * ## Why one list
 *
 * The sidebar was hand-written markup and each section drew its own header, so the names, the
 * permissions and the order lived in three places and drifted apart: eleven sections were called
 * one thing in the sidebar and another on the page, finance sections were shown to people who
 * could not open them, and the default accounts were split across six sections nobody could find.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  // ── My account: only the reader ────────────────────────────────────────────────────────────
  {
    id: 'my-profile', group: 'account', scope: 'personal', icon: UserCircle,
    labelKey: 'settings.sections_meta.my_profile.label', descriptionKey: 'settings.sections_meta.my_profile.description',
    keywordsKey: 'settings.sections_meta.my_profile.keywords', inputs: { view: 'profile' },
    load: () => import('../my-profile/my-profile.page').then((m) => m.MyProfilePage),
  },
  {
    id: 'account-security', group: 'account', scope: 'personal', icon: KeyRound,
    labelKey: 'settings.sections_meta.account_security.label', descriptionKey: 'settings.sections_meta.account_security.description',
    keywordsKey: 'settings.sections_meta.account_security.keywords', inputs: { view: 'security' }, focusable: true,
    load: () => import('../my-profile/my-profile.page').then((m) => m.MyProfilePage),
  },
  {
    id: 'preferences', group: 'account', scope: 'personal', icon: SlidersHorizontal,
    labelKey: 'settings.sections_meta.preferences.label', descriptionKey: 'settings.sections_meta.preferences.description',
    keywordsKey: 'settings.sections_meta.preferences.keywords', inputs: { view: 'personal' },
    load: () => import('../branding/branding.page').then((m) => m.BrandingPage),
  },
  {
    id: 'organizations', group: 'account', scope: 'personal', icon: Building2,
    labelKey: 'settings.sections_meta.organizations.label', descriptionKey: 'settings.sections_meta.organizations.description',
    keywordsKey: 'settings.sections_meta.organizations.keywords',
    load: () => import('../account/organizations/organizations.page').then((m) => m.OrganizationsSettingsPage),
  },

  // ── Company: everyone in it ────────────────────────────────────────────────────────────────
  {
    id: 'profile', group: 'company', scope: 'company', icon: Building,
    labelKey: 'settings.sections_meta.profile.label', descriptionKey: 'settings.sections_meta.profile.description',
    keywordsKey: 'settings.sections_meta.profile.keywords', editPermission: 'settings:edit_company',
    load: () => import('../company-profile/company-profile.page').then((m) => m.CompanyProfilePage),
  },
  {
    id: 'regional-format', group: 'company', scope: 'company', icon: Languages,
    labelKey: 'settings.sections_meta.regional_format.label', descriptionKey: 'settings.sections_meta.regional_format.description',
    keywordsKey: 'settings.sections_meta.regional_format.keywords', editPermission: 'settings:edit_company', inputs: { view: 'company' },
    load: () => import('../regional-format/regional-format.page').then((m) => m.RegionalFormatPage),
  },
  {
    id: 'branding', group: 'company', scope: 'company', icon: Palette,
    labelKey: 'settings.sections_meta.branding.label', descriptionKey: 'settings.sections_meta.branding.description',
    keywordsKey: 'settings.sections_meta.branding.keywords', editPermission: 'settings:edit_branding', inputs: { view: 'company' },
    load: () => import('../branding/branding.page').then((m) => m.BrandingPage),
  },
  {
    id: 'subsidiaries', group: 'company', scope: 'company', icon: Database,
    labelKey: 'settings.sections_meta.subsidiaries.label', descriptionKey: 'settings.sections_meta.subsidiaries.description',
    keywordsKey: 'settings.sections_meta.subsidiaries.keywords', viewPermission: 'settings:edit_company',
    load: () => import('../organization/subsidiaries/subsidiaries.page').then((m) => m.SubsidiariesPage),
  },
  {
    id: 'branches', group: 'company', scope: 'company', icon: MapPin,
    labelKey: 'settings.sections_meta.branches.label', descriptionKey: 'settings.sections_meta.branches.description',
    keywordsKey: 'settings.sections_meta.branches.keywords', viewPermission: 'branches:view', editPermission: 'branches:manage',
    load: () => import('../organization/branches/branches.page').then((m) => m.BranchesSettingsPage),
  },
  {
    id: 'smtp', group: 'company', scope: 'company', icon: Mail,
    labelKey: 'settings.sections_meta.smtp.label', descriptionKey: 'settings.sections_meta.smtp.description',
    keywordsKey: 'settings.sections_meta.smtp.keywords', viewPermission: 'settings:edit_company',
    load: () => import('../system/smtp/smtp.page').then((m) => m.SmtpSettingsPage),
  },
  {
    id: 'billing', group: 'company', scope: 'company', icon: CreditCard,
    labelKey: 'settings.sections_meta.billing.label', descriptionKey: 'settings.sections_meta.billing.description',
    keywordsKey: 'settings.sections_meta.billing.keywords', viewPermission: 'billing:view', editPermission: 'billing:manage',
    load: () => import('../billing/billing.page').then((m) => m.BillingPage),
  },

  // ── Accounting and tax ─────────────────────────────────────────────────────────────────────
  {
    id: 'default-accounts', group: 'accounting', scope: 'company', icon: BookOpenCheck,
    labelKey: 'settings.sections_meta.default_accounts.label', descriptionKey: 'settings.sections_meta.default_accounts.description',
    keywordsKey: 'settings.sections_meta.default_accounts.keywords', viewPermission: 'settings:edit_company', focusable: true,
    load: () => import('../finance/default-accounts/default-accounts.page').then((m) => m.DefaultAccountsPage),
  },
  {
    id: 'accounting-policies', group: 'accounting', scope: 'company', icon: Scale,
    labelKey: 'settings.sections_meta.accounting_policies.label', descriptionKey: 'settings.sections_meta.accounting_policies.description',
    keywordsKey: 'settings.sections_meta.accounting_policies.keywords', viewPermission: 'settings:edit_company', focusable: true,
    load: () => import('../finance/accounting-policies/accounting-policies.page').then((m) => m.AccountingPoliciesPage),
  },
  {
    id: 'fiscal', group: 'accounting', scope: 'company', icon: ReceiptText, countries: ['DO'],
    labelKey: 'settings.sections_meta.fiscal.label', descriptionKey: 'settings.sections_meta.fiscal.description',
    keywordsKey: 'settings.sections_meta.fiscal.keywords', viewPermission: 'taxes:view', editPermission: 'taxes:edit',
    load: () => import('../fiscal/fiscal.page').then((m) => m.FiscalSettingsPage),
  },
  {
    id: 'einvoicing-regime', group: 'accounting', scope: 'company', icon: Landmark, exceptCountries: ['DO'],
    labelKey: 'settings.sections_meta.einvoicing_regime.label', descriptionKey: 'settings.sections_meta.einvoicing_regime.description',
    keywordsKey: 'settings.sections_meta.einvoicing_regime.keywords', viewPermission: 'taxes:view', editPermission: 'taxes:edit',
    load: () => import('../finance/einvoicing-regime/einvoicing-regime.page').then((m) => m.EinvoicingRegimePage),
  },
  {
    id: 'withholding-regimes', group: 'accounting', scope: 'company', icon: ShieldCheck,
    labelKey: 'settings.sections_meta.withholding_regimes.label', descriptionKey: 'settings.sections_meta.withholding_regimes.description',
    keywordsKey: 'settings.sections_meta.withholding_regimes.keywords', viewPermission: 'taxes:view', editPermission: 'taxes:edit',
    load: () => import('../finance/withholding-regimes/withholding-regimes.page').then((m) => m.WithholdingRegimesPage),
  },
  {
    id: 'tax-jurisdictions', group: 'accounting', scope: 'company', icon: MapPinned, countries: ['US', 'BR'],
    labelKey: 'settings.sections_meta.tax_jurisdictions.label', descriptionKey: 'settings.sections_meta.tax_jurisdictions.description',
    keywordsKey: 'settings.sections_meta.tax_jurisdictions.keywords', viewPermission: 'taxes:view', editPermission: 'taxes:edit',
    load: () => import('../finance/tax-jurisdictions/tax-jurisdictions.page').then((m) => m.TaxJurisdictionsPage),
  },
  {
    id: 'sequences', group: 'accounting', scope: 'company', icon: Hash,
    labelKey: 'settings.sections_meta.sequences.label', descriptionKey: 'settings.sections_meta.sequences.description',
    keywordsKey: 'settings.sections_meta.sequences.keywords', viewPermission: 'settings:edit_company',
    load: () => import('../operations/sequences/sequences.page').then((m) => m.SequenceSettingsPage),
  },

  // ── Operations ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'approvals', group: 'operations', scope: 'company', icon: Workflow,
    labelKey: 'settings.sections_meta.approvals.label', descriptionKey: 'settings.sections_meta.approvals.description',
    keywordsKey: 'settings.sections_meta.approvals.keywords', viewPermission: 'workflows:manage',
    load: () => import('../operations/approvals/approvals.page').then((m) => m.ApprovalPoliciesPage),
  },

  // ── Administration ─────────────────────────────────────────────────────────────────────────
  {
    id: 'users', group: 'admin', scope: 'admin', icon: Users,
    labelKey: 'settings.sections_meta.users.label', descriptionKey: 'settings.sections_meta.users.description',
    keywordsKey: 'settings.sections_meta.users.keywords', viewPermission: 'users:view', editPermission: 'users:edit',
    load: () => import('../user-management/user-management.page').then((m) => m.UserManagementPage),
  },
  {
    id: 'roles', group: 'admin', scope: 'admin', icon: Shield,
    labelKey: 'settings.sections_meta.roles.label', descriptionKey: 'settings.sections_meta.roles.description',
    keywordsKey: 'settings.sections_meta.roles.keywords', viewPermission: 'roles:view', editPermission: 'roles:edit',
    load: () => import('../roles/roles.page').then((m) => m.RolesManagementPage),
  },
  {
    id: 'security', group: 'admin', scope: 'admin', icon: Lock,
    labelKey: 'settings.sections_meta.security.label', descriptionKey: 'settings.sections_meta.security.description',
    keywordsKey: 'settings.sections_meta.security.keywords', editPermission: 'settings:edit_company', inputs: { view: 'policy' },
    load: () => import('../system/security/security.page').then((m) => m.SecuritySettingsPage),
  },
  {
    id: 'audit-trail', group: 'admin', scope: 'admin', icon: ScrollText,
    labelKey: 'settings.sections_meta.audit_trail.label', descriptionKey: 'settings.sections_meta.audit_trail.description',
    keywordsKey: 'settings.sections_meta.audit_trail.keywords', viewPermission: 'audit:view_trail', inputs: { view: 'trail' },
    load: () => import('../system/security/security.page').then((m) => m.SecuritySettingsPage),
  },
  {
    id: 'sso', group: 'admin', scope: 'admin', icon: KeyRound,
    labelKey: 'settings.sections_meta.sso.label', descriptionKey: 'settings.sections_meta.sso.description',
    keywordsKey: 'settings.sections_meta.sso.keywords', viewPermission: 'settings:edit_company',
    load: () => import('../system/sso/sso.page').then((m) => m.SsoSettingsPage),
  },
  {
    id: 'integrations', group: 'admin', scope: 'admin', icon: Server,
    labelKey: 'settings.sections_meta.integrations.label', descriptionKey: 'settings.sections_meta.integrations.description',
    keywordsKey: 'settings.sections_meta.integrations.keywords', viewPermission: 'settings:edit_company',
    load: () => import('../system/integrations/integrations.page').then((m) => m.IntegrationSettingsPage),
  },
  {
    id: 'ai', group: 'admin', scope: 'admin', icon: Sparkles,
    labelKey: 'settings.sections_meta.ai.label', descriptionKey: 'settings.sections_meta.ai.description',
    keywordsKey: 'settings.sections_meta.ai.keywords', viewPermission: 'ai_usage:view', editPermission: 'ai_settings:manage',
    load: () => import('../system/ai/ai-settings.page').then((m) => m.AiSettingsPage),
  },
  {
    id: 'extensions', group: 'admin', scope: 'admin', icon: Puzzle,
    labelKey: 'settings.sections_meta.extensions.label', descriptionKey: 'settings.sections_meta.extensions.description',
    keywordsKey: 'settings.sections_meta.extensions.keywords', viewPermission: 'extensions:view', editPermission: 'extensions:manage', inputs: { embedded: true },
    load: () => import('../../extensions/extensions.page').then((m) => m.ExtensionsPage),
  },
];

/**
 * Ids that used to exist, and where they lead now — every link the product (or a bookmark) holds
 * to `#settings/<old id>` keeps working. The second element is the group to bring into view.
 */
export const SETTINGS_ALIASES: Readonly<Record<string, readonly [string, string?]>> = {
  accounting: ['default-accounts', 'sales'],
  currencies: ['accounting-policies', 'currency'],
  taxes: ['default-accounts', 'taxes'],
  'closing-rules': ['accounting-policies', 'closing'],
  intercompany: ['default-accounts', 'intercompany'],
  'inventory-policies': ['default-accounts', 'inventory'],
  sessions: ['account-security', 'sessions'],
};
