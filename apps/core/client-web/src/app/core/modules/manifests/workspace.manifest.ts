import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * The workspace itself: what belongs to no single domain.
 *
 * Home (with the business indicators on it), the approvals inbox, search, the document repository
 * and the import/export ledger. They are grouped here rather than scattered because none of them is
 * owned by Sales or Accounting — they are the shell the modules live in.
 *
 * There used to be five ways in: Home, Dashboard, «Mi trabajo», Approvals and Notifications.
 * «Mi trabajo» returned the approvals the user could decide, under another name; Dashboard was a
 * second home. No reference ERP splits it that way — NetSuite has one Home with portlets, SAP one
 * launchpad and one «My Inbox» — so there is one home, one inbox, and the notifications page is
 * what the bell's «Ver todas» opens.
 */
export const WORKSPACE_MODULE: ModuleManifest = {
  id: 'workspace',
  titleKey: 'modules.workspace',
  icon: 'LayoutGrid',
  basePath: '',
  order: 0,
  routes: [
    {
      // An external AI agent asking to act as the signed-in person (MCP, OAuth). Reached from the agent, not the menu.
      path: 'oauth/consent',
      kind: WindowKind.OVERVIEW,
      permission: 'ai_copilot:use',
      titleKey: 'page_titles.mcp_consent',
      icon: 'ShieldCheck',
      entityKeyFn: () => 'workspace:mcp-consent',
      load: () => import('../../../features/ai/mcp/mcp-consent.page').then((m) => m.McpConsentPage),
    },
    {
      // A draft an external agent (or the assistant) proposed, to confirm or discard.
      path: 'ai/proposals/:id',
      kind: WindowKind.DOCUMENT,
      permission: 'ai_copilot:use',
      titleKey: 'page_titles.ai_proposal',
      icon: 'Sparkles',
      entityKeyFn: (p) => `workspace:ai-proposal:${p['id']}`,
      load: () => import('../../../features/ai/proposals/proposal.page').then((m) => m.ProposalPage),
    },
    {
      path: 'overview',
      kind: WindowKind.OVERVIEW,
      permission: 'authenticated',
      titleKey: 'page_titles.home',
      icon: 'Home',
      //  Fija (permanente, primera, sin vista previa; se recrea al arrancar) pero
      //  AHORA cerrable: el usuario puede descartarla durante la sesión y vuelve
      //  en el siguiente arranque. `isCloseable` es true por defecto.
      pinned: true,
      entityKeyFn: () => 'workspace:overview',
      menu: { group: 'inbox', labelKey: 'sidebar.general.home' },
      load: () => import('../../../features/overview/overview.page').then((m) => m.OverviewPage),
    },
    {
      path: 'approvals',
      kind: WindowKind.INBOX,
      permission: 'workflows:decide',
      titleKey: 'page_titles.approvals',
      icon: 'CheckSquare',
      entityKeyFn: () => 'workspace:approvals',
      menu: { group: 'inbox', labelKey: 'sidebar.general.approvals' },
      load: () => import('../../../features/approvals/approvals.page').then((m) => m.ApprovalsPage),
    },
    {
      //  SAP Business Workflow: the process catalogue. The designer and the runs hang off it.
      path: 'workflows',
      kind: WindowKind.LIST,
      permission: 'workflow_engine:view',
      titleKey: 'workflow_engine.title',
      icon: 'Workflow',
      entityKeyFn: () => 'workspace:workflows',
      menu: { group: 'configuration', labelKey: 'workflow_engine.nav.workflows' },
      load: () => import('../../../features/workflow/list/workflow-list.page').then((m) => m.WorkflowListPage),
    },
    {
      //  The visual designer: a free canvas, not a document — hence CANVAS. Opening is VIEW; the
      //  server enforces DESIGN on save and publish, so a viewer sees the graph read-only.
      path: 'workflows/:id/edit',
      kind: WindowKind.CANVAS,
      permission: 'workflow_engine:view',
      titleKey: 'workflow_engine.title',
      icon: 'Workflow',
      entityKeyFn: (p) => `workspace:workflow:${p['id']}`,
      load: () => import('../../../features/workflow/designer/workflow-designer.page').then((m) => m.WorkflowDesignerPage),
    },
    {
      path: 'workflow-instances',
      kind: WindowKind.LIST,
      permission: 'workflow_engine:view',
      titleKey: 'workflow_engine.nav.instances',
      icon: 'History',
      entityKeyFn: () => 'workspace:workflow-instances',
      menu: { group: 'configuration', labelKey: 'workflow_engine.nav.instances' },
      load: () => import('../../../features/workflow/instances/workflow-instances.page').then((m) => m.WorkflowInstancesPage),
    },
    {
      //  The runtime view: the instance's path through its graph, drawn on the shared canvas.
      path: 'workflow-instances/:id',
      kind: WindowKind.CANVAS,
      permission: 'workflow_engine:view',
      titleKey: 'workflow_engine.nav.instances',
      icon: 'History',
      entityKeyFn: (p) => `workspace:workflow-instance:${p['id']}`,
      load: () => import('../../../features/workflow/instances/workflow-instance.page').then((m) => m.WorkflowInstancePage),
    },
    {
      path: 'workflow-tasks',
      kind: WindowKind.INBOX,
      permission: 'workflow_engine:act',
      titleKey: 'workflow_engine.nav.tasks',
      icon: 'CheckSquare',
      entityKeyFn: () => 'workspace:workflow-tasks',
      menu: { group: 'inbox', labelKey: 'workflow_engine.nav.tasks' },
      load: () => import('../../../features/workflow/tasks/workflow-tasks.page').then((m) => m.WorkflowTasksPage),
    },
    {
      //  The bell in the top bar is where notifications are read; this is its «Ver todas». A menu
      //  entry made it a third inbox beside approvals.
      path: 'notifications',
      kind: WindowKind.LIST,
      permission: 'authenticated',
      titleKey: 'page_titles.notifications',
      icon: 'Bell',
      entityKeyFn: () => 'workspace:notifications',
      load: () => import('../../../features/notifications/notifications.page').then((m) => m.NotificationsPage),
    },
    {
      path: 'global-search',
      kind: WindowKind.LIST,
      permission: 'authenticated',
      titleKey: 'page_titles.search',
      icon: 'Search',
      entityKeyFn: () => 'workspace:global-search',
      load: () => import('../../../features/global-search/global-search.page').then((m) => m.GlobalSearchPage),
    },
    {
      //  Un asistente de tres pasos, no una lista: elegir el tipo de dato, subir el fichero y
      //  revisar el resultado. Declararlo LIST obligaba a medirlo con la anatomía de una lista.
      path: 'data-imports',
      kind: WindowKind.CANVAS,
      permission: 'settings:edit_company',
      titleKey: 'page_titles.data_imports',
      icon: 'UploadCloud',
      entityKeyFn: () => 'workspace:data-imports',
      load: () => import('../../../features/data-imports/data-imports.page').then((m) => m.DataImportsPage),
    },
    {
      //  Un formulario que lanza una exportación, con el historial de las anteriores debajo. Eso
      //  SÍ es una lista —la de exportaciones— con su formulario proyectado dentro.
      path: 'data-exports',
      kind: WindowKind.LIST,
      permission: 'settings:edit_company',
      titleKey: 'page_titles.data_exports',
      icon: 'DownloadCloud',
      entityKeyFn: () => 'workspace:data-exports',
      load: () => import('../../../features/data-exports/data-exports.page').then((m) => m.DataExportsPage),
    },
    {
      path: 'documents/repository',
      kind: WindowKind.LIST,
      // The repository holds whatever a business keeps — contracts, bank statements, personnel
      // files — so "is signed in" is not the right test for reading all of it.
      permission: 'documents:view',
      titleKey: 'page_titles.document_repository',
      icon: 'FolderArchive',
      entityKeyFn: () => 'workspace:documents',
      menu: { group: 'documents', labelKey: 'sidebar.general.documents_sub.all' },
      load: () => import('../../../features/documents/repository/repository.page').then((m) => m.RepositoryPage),
    },
    {
      // The client-side extension runtime: where enabled UI extensions actually render, each in
      // its own sandboxed iframe host.
      path: 'extensions/run',
      kind: WindowKind.CANVAS,
      permission: 'extensions:view',
      titleKey: 'page_titles.extensions_runtime',
      icon: 'Puzzle',
      entityKeyFn: () => 'workspace:extensions-runtime',
      load: () =>
        import('../../../features/extensions/extensions-runtime.page').then(
          (m) => m.ExtensionsRuntimePage,
        ),
    },
    {
      path: 'unauthorized',
      kind: WindowKind.OVERVIEW,
      permission: 'authenticated',
      titleKey: 'page_titles.access_denied',
      icon: 'ShieldAlert',
      entityKeyFn: () => 'workspace:unauthorized',
      load: () => import('../../../features/unauthorized/unauthorized.page').then((m) => m.UnauthorizedPage),
    },
  ],
};
