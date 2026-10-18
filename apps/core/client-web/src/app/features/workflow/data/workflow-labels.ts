import { TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import {
  CircleDot,
  Clock,
  GitBranch,
  ShieldCheck,
  Square,
  UserCheck,
  Zap,
} from 'lucide-angular';
import type { VxTone } from '../../../shared/components/badge/badge.component';
import {
  WorkflowDefinitionStatus,
  WorkflowInstanceStatus,
  WorkflowIssue,
  WorkflowNodeType,
  WorkflowTaskStatus,
} from './workflow.service';

/**
 * The words and marks the workflow screens share, in one place.
 *
 * Every label that comes from data — an outcome an author typed, an event the server catalogues,
 * a validation problem — is composed into a catalogue key with `composeKey`, the same way the rest
 * of the product does, so the reader sees their own language and never a raw identifier.
 */

export const NODE_ICONS: Record<WorkflowNodeType, unknown> = {
  start: CircleDot,
  end: Square,
  task: UserCheck,
  approval: ShieldCheck,
  condition: GitBranch,
  action: Zap,
  timer: Clock,
};

/** Outcomes the catalogue knows; anything else an author typed is shown as they wrote it. */
const KNOWN_OUTCOMES = new Set(['approve', 'reject', 'done', 'ok', 'error', 'return', 'sent', 'drafted', 'skipped', 'ordered', 'nothing']);

export function outcomeLabel(
  translate: TranslateService,
  outcome: string,
  labels?: Record<string, string> | null,
): string {
  const own = labels?.[outcome]?.trim();
  if (own) return own;
  if (KNOWN_OUTCOMES.has(outcome)) return translate.instant(composeKey('workflow_engine.outcome', outcome));
  return outcome.charAt(0).toUpperCase() + outcome.slice(1).replace(/[_-]+/g, ' ');
}

export function eventLabel(translate: TranslateService, event: string | undefined | null): string {
  if (!event) return '';
  if (event.startsWith('custom.')) return event;
  const key = composeKey('workflow_engine.event', event);
  const text = translate.instant(key);
  return text === key ? event : text;
}

export function eventFieldLabel(translate: TranslateService, name: string, label?: string | null): string {
  // A label the server sent as a catalogue key is translated below; anything else is the author's own text.
  if (label && !/^workflow_engine\./.test(label)) return label;
  const key = composeKey('workflow_engine.event_field', name);
  const text = translate.instant(key);
  return text === key ? name : text;
}

/**
 * A validation problem in the reader's words. The server names a step by its name, or by its id
 * when it has none; `nameOf` lets the screen put the label the reader sees on the canvas instead.
 */
export function issueMessage(
  translate: TranslateService,
  issue: WorkflowIssue,
  nameOf?: (nodeId: string) => string | undefined,
): string {
  const params: Record<string, string | number> = { ...(issue.params ?? {}) };
  if (nameOf && issue.nodeId) {
    const name = nameOf(issue.nodeId);
    if (name) params['node'] = name;
  }
  return translate.instant(composeKey('workflow_engine.issue', issue.code), params);
}

export function definitionStatusTone(status: WorkflowDefinitionStatus): VxTone {
  return status === 'PUBLISHED' ? 'ok' : status === 'DRAFT' ? 'draft' : 'neutral';
}

export function instanceStatusTone(status: WorkflowInstanceStatus): VxTone {
  switch (status) {
    case 'RUNNING':
      return 'info';
    case 'COMPLETED':
      return 'ok';
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function taskStatusTone(status: WorkflowTaskStatus): VxTone {
  return status === 'OPEN' ? 'info' : status === 'COMPLETED' ? 'ok' : 'neutral';
}

export function definitionStatusKey(status: WorkflowDefinitionStatus): string {
  return composeKey('workflow_engine.definition_status', status);
}

export function instanceStatusKey(status: WorkflowInstanceStatus): string {
  return composeKey('workflow_engine.instance_status', status);
}

export function nodeTypeKey(type: WorkflowNodeType): string {
  return composeKey('workflow_engine.node', type);
}

/** An outcome that ends a decision negatively reads as such on its button. */
export function outcomeTone(outcome: string): 'primary' | 'danger' | 'neutral' {
  if (/^(approve|ok|done|accept|aprobar|si)$/i.test(outcome)) return 'primary';
  if (/^(reject|deny|error|rechazar|no|cancel)$/i.test(outcome)) return 'danger';
  return 'neutral';
}
