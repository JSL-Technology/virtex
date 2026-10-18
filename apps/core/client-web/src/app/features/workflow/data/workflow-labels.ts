import { TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { translateOrLiteral } from '@virteex/shared/ui-i18n';
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
  return translateOrLiteral(translate, composeKey('workflow_engine.event', event), undefined, event);
}

export function eventFieldLabel(translate: TranslateService, name: string, label?: string | null): string {
  // A label the server sent as a catalogue key is translated below; anything else is the author's own text.
  if (label && !/^workflow_engine\./.test(label)) return label;
  // Never the raw key: the missing-translation handler answers «[[key]]», which the old `=== key`
  // test let through to the screen (QA A-05).
  return translateOrLiteral(translate, composeKey('workflow_engine.event_field', name), undefined, name);
}

/**
 * Why a run failed, in the reader's words. The engine stores a catalogue key for every failure it
 * understands (`workflow_engine.runtime.no_exit`, `workflow_engine.subprocess_too_deep`) and the
 * raw message only for an unexpected one, which is shown as it is — it is what support needs.
 */
export function runFailureText(translate: TranslateService, error: string | null | undefined, params?: Record<string, unknown>): string {
  if (!error) return '—';
  if (/^workflow_engine\.[a-z0-9_.]+$/.test(error)) {
    return translateOrLiteral(translate, error, params, translate.instant('workflow_engine.runtime.unexpected', { detail: error }));
  }
  return translate.instant('workflow_engine.runtime.unexpected', { detail: error });
}

/**
 * The catalogue key for a count: `base.one` for «1 paso copiado», `base.other` for «3 pasos
 * copiados», by the language's CLDR rules — the same choice `vxPluralKey` makes in templates.
 */
export function pluralKey(translate: TranslateService, base: string, count: number): string {
  const language = translate.getCurrentLang() || translate.getFallbackLang() || 'es';
  return `${base}.${new Intl.PluralRules(language).select(count) === 'one' ? 'one' : 'other'}`;
}

/** The steps a running instance waits on, by name or, for an unnamed step, by its kind — never `timer`. */
export function currentStepsText(
  translate: TranslateService,
  run: { currentNodes?: Array<{ name: string | null; type: string }>; currentSteps?: string[] },
): string {
  const steps = run.currentNodes?.length
    ? run.currentNodes.map((node) => node.name || translate.instant(composeKey('workflow_engine.node', node.type)))
    : (run.currentSteps ?? []);
  return steps.join(', ') || '—';
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
