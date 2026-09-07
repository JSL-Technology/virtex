import { MenuGroup } from './module-manifest';

/**
 * The four group headings, named once.
 *
 * `Record<MenuGroup, string>` and not a partial map: adding a fifth group to `MenuGroup` stops
 * compiling here until somebody decides what it is called in three languages. The vertical panel
 * and the horizontal mega-menu both read this, so the same module cannot be described with two
 * different vocabularies depending on which shell the tenant chose.
 */
export const GROUP_LABEL: Record<MenuGroup, string> = {
  inbox: 'SHELL.GROUP_INBOX',
  documents: 'SHELL.GROUP_DOCUMENTS',
  masters: 'SHELL.GROUP_MASTERS',
  analysis: 'SHELL.GROUP_ANALYSIS',
};
