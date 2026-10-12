import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { LucideAngularModule, Workflow } from 'lucide-angular';
import { VxBadgeComponent } from '../../../../shared/components/badge/badge.component';
import { definitionStatusKey, definitionStatusTone, eventFieldLabel, eventLabel } from '../../data/workflow-labels';
import { ConnectionStyle, WorkflowDefinition, WorkflowPredicate, WorkflowVariable } from '../../data/workflow.service';
import { ConditionEditorComponent } from '../condition-editor.component';
import { DesignerCatalogs } from '../designer-catalogs';
import { DesignerStore } from '../designer-store';
import { VariablesEditorComponent } from './variables-editor.component';

const CUSTOM = '__custom';

/**
 * Properties of the process itself, shown when nothing on the canvas is selected: its name, what
 * starts it (a person, or a business event with an optional filter), the data it carries, and how
 * it is drawn.
 */
@Component({
  selector: 'app-workflow-process-panel',
  standalone: true,
  imports: [DatePipe, TranslateModule, LucideAngularModule, VxBadgeComponent, ConditionEditorComponent, VariablesEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './inspector.scss',
  template: `
    @let doc = store.doc();
    @let trigger = doc.trigger;
    <header class="insp-head">
      <span class="insp-kind" aria-hidden="true"><lucide-icon [img]="ProcessIcon" [size]="16" /></span>
      <h3>{{ 'workflow_engine.designer.process' | translate }}</h3>
    </header>

    @if (definition(); as def) {
      <section class="insp-section">
        <div class="insp-meta">
          <vx-badge [tone]="statusTone(def)">{{ statusKey(def) | translate }}</vx-badge>
          <span>{{ 'workflow_engine.version' | translate: { version: def.version } }}</span>
          <span class="insp-mono">{{ def.key }}</span>
        </div>
        @if (def.publishedAt) {
          <p class="insp-hint">{{ 'workflow_engine.designer.published_on' | translate: { date: (def.publishedAt | date: 'medium') } }}</p>
        }
      </section>
    }

    <section class="insp-section">
      <h4 class="insp-section__title">{{ 'workflow_engine.designer.general' | translate }}</h4>
      <div class="insp-field">
        <label for="process-name">{{ 'workflow_engine.field.name' | translate }} <span aria-hidden="true">*</span></label>
        <input id="process-name" type="text" maxlength="160" required aria-required="true" [value]="doc.name" [readOnly]="readonly()"
          [attr.aria-invalid]="!doc.name.trim() || null" (input)="store.setName($any($event.target).value)" />
        @if (!doc.name.trim()) {
          <p class="insp-error" role="alert">{{ 'workflow_engine.designer.name_required' | translate }}</p>
        }
      </div>
      <div class="insp-field">
        <label for="process-description">{{ 'workflow_engine.field.description' | translate }}</label>
        <textarea id="process-description" rows="3" maxlength="2000" [value]="doc.description" [readOnly]="readonly()"
          (input)="store.setDescription($any($event.target).value)"></textarea>
      </div>
    </section>

    <section class="insp-section">
      <h4 class="insp-section__title">{{ 'workflow_engine.trigger.title' | translate }}</h4>
      <div class="insp-segmented" role="group" [attr.aria-label]="'workflow_engine.trigger.title' | translate">
        <button type="button" [attr.aria-pressed]="trigger.mode === 'manual'" [disabled]="readonly()" (click)="store.setTrigger({ mode: 'manual' })">
          {{ 'workflow_engine.trigger.manual' | translate }}
        </button>
        <button type="button" [attr.aria-pressed]="trigger.mode === 'event'" [disabled]="readonly()" (click)="store.setTrigger({ mode: 'event', event: trigger.event })">
          {{ 'workflow_engine.trigger.event' | translate }}
        </button>
      </div>
      @if (trigger.mode === 'manual') {
        <p class="insp-hint">{{ 'workflow_engine.trigger.manual_hint' | translate }}</p>
      } @else {
        <div class="insp-field">
          <label for="process-event">{{ 'workflow_engine.trigger.event_name' | translate }}</label>
          <select id="process-event" [value]="eventChoice()" [disabled]="readonly()" (change)="chooseEvent($any($event.target).value)">
            <option value="">{{ 'workflow_engine.trigger.choose_event' | translate }}</option>
            @for (group of eventGroups(); track group.key) {
              <optgroup [label]="group.label">
                @for (event of group.events; track event.key) {
                  <option [value]="event.key" [selected]="event.key === eventChoice()">{{ event.label }}</option>
                }
              </optgroup>
            }
            <option [value]="custom" [selected]="eventChoice() === custom">{{ 'workflow_engine.trigger.custom_event' | translate }}</option>
          </select>
        </div>
        @if (eventChoice() === custom) {
          <div class="insp-field">
            <label for="process-custom-event">{{ 'workflow_engine.trigger.custom_name' | translate }}</label>
            <input id="process-custom-event" type="text" maxlength="120" spellcheck="false" [value]="customName()" [readOnly]="readonly()"
              [attr.aria-invalid]="!!customName() && !customValid() || null" (input)="setCustom($any($event.target).value)" />
            <p class="insp-hint">{{ 'workflow_engine.trigger.custom_hint' | translate: { prefix: catalogs.events().customPrefix } }}</p>
          </div>
        }
        @if (eventFields().length) {
          <p class="insp-hint">{{ 'workflow_engine.trigger.fields' | translate: { fields: eventFieldList() } }}</p>
        }
        <div class="insp-field">
          <span class="insp-label">{{ 'workflow_engine.trigger.filter' | translate }}</span>
          <p class="insp-hint">{{ 'workflow_engine.trigger.filter_hint' | translate }}</p>
          <app-workflow-condition-editor [value]="trigger.filter" [variables]="catalogs.availableVariables()" [readonly]="readonly()"
            (valueChange)="setFilter($event)" />
        </div>
      }
    </section>

    <section class="insp-section">
      <h4 class="insp-section__title">{{ 'workflow_engine.variables.title' | translate }}</h4>
      <p class="insp-hint">{{ 'workflow_engine.variables.hint' | translate }}</p>
      <app-workflow-variables-editor [value]="doc.variables" [readonly]="readonly()" idPrefix="process-var"
        (valueChange)="setVariables($event.value, $event.coalesce)" />
    </section>

    <section class="insp-section">
      <h4 class="insp-section__title">{{ 'workflow_engine.designer.appearance' | translate }}</h4>
      <div class="insp-field">
        <label for="process-connection">{{ 'workflow_engine.designer.connection_style' | translate }}</label>
        <select id="process-connection" [value]="doc.settings.connectionType ?? 'bezier'" [disabled]="readonly()"
          (change)="store.setSettings({ connectionType: $any($event.target).value })">
          @for (style of styles; track style) {
            <option [value]="style">{{ styleKey(style) | translate }}</option>
          }
        </select>
      </div>
      <div class="insp-field">
        <label for="process-direction">{{ 'workflow_engine.designer.direction' | translate }}</label>
        <select id="process-direction" [value]="doc.settings.layoutDirection ?? 'LR'" [disabled]="readonly()"
          (change)="store.setSettings({ layoutDirection: $any($event.target).value })">
          <option value="LR">{{ 'workflow_engine.designer.direction_lr' | translate }}</option>
          <option value="TB">{{ 'workflow_engine.designer.direction_tb' | translate }}</option>
        </select>
      </div>
    </section>
  `,
  styles: [
    `
      .insp-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--content-secondary);
      }
    `,
  ],
})
export class ProcessPanelComponent {
  protected readonly store = inject(DesignerStore);
  protected readonly catalogs = inject(DesignerCatalogs);
  private readonly translate = inject(TranslateService);

  readonly definition = input<WorkflowDefinition | null>(null);
  readonly readonly = input(false);

  protected readonly ProcessIcon = Workflow;
  protected readonly custom = CUSTOM;
  protected readonly styles: ConnectionStyle[] = ['bezier', 'segment', 'adaptive-curve', 'straight'];

  readonly eventGroups = computed(() => {
    const groups = new Map<string, Array<{ key: string; label: string }>>();
    for (const event of this.catalogs.events().events) {
      const list = groups.get(event.group) ?? [];
      list.push({ key: event.key, label: eventLabel(this.translate, event.key) });
      groups.set(event.group, list);
    }
    return [...groups.entries()].map(([key, events]) => ({
      key,
      label: this.translate.instant(composeKey('workflow_engine.event_group', key)),
      events: events.sort((a, b) => a.label.localeCompare(b.label)),
    }));
  });

  readonly eventChoice = computed(() => {
    const event = this.store.trigger().event;
    if (event === undefined) return '';
    return event.startsWith(this.catalogs.events().customPrefix) ? CUSTOM : event;
  });

  readonly customName = computed(() => {
    const event = this.store.trigger().event ?? '';
    const prefix = this.catalogs.events().customPrefix;
    return event.startsWith(prefix) ? event.slice(prefix.length) : '';
  });

  readonly customValid = computed(() => /^[a-z0-9][a-z0-9_.-]*$/.test(this.customName()));

  readonly eventFields = computed(() => {
    const event = this.store.trigger().event;
    return this.catalogs.events().events.find((e) => e.key === event)?.fields ?? [];
  });
  readonly eventFieldList = computed(() => this.eventFields().map((f) => eventFieldLabel(this.translate, f.name, f.label)).join(', '));

  statusTone(def: WorkflowDefinition) {
    return definitionStatusTone(def.status);
  }

  statusKey(def: WorkflowDefinition): string {
    return definitionStatusKey(def.status);
  }

  styleKey(style: ConnectionStyle): string {
    return composeKey('workflow_engine.connection_style', style);
  }

  chooseEvent(value: string): void {
    const trigger = this.store.trigger();
    // A different event has different fields: a filter written for the old one no longer applies.
    if (value === CUSTOM) this.store.setTrigger({ mode: 'event', event: this.catalogs.events().customPrefix, filter: undefined });
    else this.store.setTrigger({ mode: 'event', event: value || undefined, filter: value === trigger.event ? trigger.filter : undefined });
  }

  setCustom(name: string): void {
    const clean = name.trim().toLowerCase();
    this.store.setTrigger({ ...this.store.trigger(), event: `${this.catalogs.events().customPrefix}${clean}` }, 'trigger:custom');
  }

  setFilter(filter: WorkflowPredicate | undefined): void {
    this.store.setTrigger({ ...this.store.trigger(), filter }, 'trigger:filter');
  }

  setVariables(variables: WorkflowVariable[], coalesce?: string): void {
    this.store.setVariables(variables, coalesce ? `vars:${coalesce}` : undefined);
  }
}
