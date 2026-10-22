import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslatePipe } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { environment } from '../../../../environments/environment';
import { VxBadgeComponent } from '../../../shared/components/badge/badge.component';

export type AiProvenanceSource = 'AI_COPILOT' | 'AI_CAPTURE' | 'AI_AGENT' | 'AI_RECONCILIATION' | 'AI_MAIL' | 'AI_MCP';

export interface AiProvenance {
  source: AiProvenanceSource;
  fields: { accepted: string[]; edited: string[] } | null;
  createdAt: string;
  agentRunId: string | null;
}

/**
 * "Proposed by the assistant", "Read from the supplier's document — 2 fields corrected": shown on a
 * record the AI had a hand in, so whoever reviews it knows to read it as such. Shows nothing for a
 * record a person entered, or when the provenance cannot be read.
 */
@Component({
  selector: 'app-ai-provenance-badge',
  standalone: true,
  imports: [TranslatePipe, VxBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of provenance(); track item.source) {
      <span class="aip" [attr.title]="detail(item)">
        <vx-badge tone="accent">
          {{ k('ai.provenance.source', item.source) | translate }}
          @if (item.fields?.edited?.length) {
            · {{ 'ai.provenance.edited' | translate: { count: item.fields!.edited.length } }}
          }
        </vx-badge>
      </span>
    }
  `,
  styles: [':host { display: inline-flex; gap: 0.25rem; flex-wrap: wrap; } .aip { cursor: help; }'],
})
export class AiProvenanceBadgeComponent {
  private readonly http = inject(HttpClient);

  readonly entityType = input.required<string>();
  readonly entityId = input<string | null | undefined>(null);

  readonly provenance = signal<AiProvenance[]>([]);
  protected readonly k = composeKey;

  constructor() {
    effect((onCleanup) => {
      const id = this.entityId();
      const type = this.entityType();
      this.provenance.set([]);
      if (!id) return;
      const request = this.http
        .get<AiProvenance[]>(`${environment.apiUrl}/ai/provenance/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
        .subscribe({ next: (rows) => this.provenance.set(rows ?? []), error: () => this.provenance.set([]) });
      onCleanup(() => request.unsubscribe());
    });
  }

  /** The fields kept and corrected, for the tooltip. */
  detail(item: AiProvenance): string | null {
    if (!item.fields) return null;
    const parts = [];
    if (item.fields.edited.length) parts.push(`✎ ${item.fields.edited.join(', ')}`);
    if (item.fields.accepted.length) parts.push(`✓ ${item.fields.accepted.join(', ')}`);
    return parts.join(' — ') || null;
  }
}
