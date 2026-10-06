/**
 * Screens that changed address, and where they live now.
 *
 * A URL is a promise: it sits in bookmarks, in e-mails the server already sent, and in every
 * workspace saved with that window open. Moving a page without this table breaks all three
 * silently — the old address resolves to nothing and the window reopens as a 404.
 *
 * Both readers use it: the router turns each entry into a redirect, and `resolveRoute` follows it
 * so a restored window opens the page it named. `:param` segments carry over by name.
 *
 * An entry stays as long as links to the old address can still exist. Removing one is a decision,
 * not cleanup.
 */
export interface MovedRoute {
  from: string;
  to: string;
}

export const MOVED_ROUTES: readonly MovedRoute[] = [
  // Home and dashboard were two homes; the indicators now live on the one home page.
  { from: '/dashboard', to: '/overview' },
  // «Mi trabajo» was the approvals inbox under a second name.
  { from: '/my-work', to: '/approvals' },
  // A ledger (multi-book) is configuration, not the general-ledger report it shared a URL with.
  { from: '/accounting/general-ledger/new', to: '/accounting/ledgers/new' },
  { from: '/accounting/general-ledger/:id/edit', to: '/accounting/ledgers/:id/edit' },
  // One period-close page instead of two views of the same checks.
  { from: '/accounting/closing/month-end', to: '/accounting/closing/checklist' },
  // Customers and suppliers share one convention.
  { from: '/masters/suppliers', to: '/contacts/suppliers' },
  { from: '/masters/suppliers/new', to: '/contacts/suppliers/new' },
  { from: '/masters/suppliers/:id/edit', to: '/contacts/suppliers/:id/edit' },
  // Extensions are administration, not master data.
  { from: '/masters/extensions/run', to: '/extensions/run' },
  { from: '/masters/extensions', to: '/settings/extensions' },
  // Was a read-only copy of the subsidiaries under the wrong name; branches are now their own
  // settings section (same legal entity, other place), and subsidiaries stay in Company structure.
  { from: '/masters/branches', to: '/settings/branches' },
  // «Procurement» announced as coming what Purchasing already does: requisitions and orders.
  { from: '/procurement', to: '/purchasing/requisitions' },
  // A template was a tagged file; the tag is a filter of the repository.
  { from: '/documents/templates', to: '/documents/repository' },
];
