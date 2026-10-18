/**
 * What another module needs to contribute an automatic step to the workflow engine: the registry
 * it registers with, the shapes of an action, and the `{{variable}}` interpolation the engine's own
 * actions use for templated parameters. The engine never learns the contributor's name.
 */
export { WorkflowActionRegistry } from '../workflow-action.registry';
export type { WorkflowAction, WorkflowActionContext, WorkflowActionResult } from '../workflow-action.registry';
export type { WorkflowActionParam } from '../validation/workflow-graph.validator';
export { interpolate } from '../workflow-directory.service';
