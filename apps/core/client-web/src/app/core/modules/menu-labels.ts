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
  inbox: 'shell.group_inbox',
  documents: 'shell.group_documents',
  masters: 'shell.group_masters',
  analysis: 'shell.group_analysis',
};
