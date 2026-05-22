import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

/**
 * Herramienta de Fusión de Cuentas (Standalone Component)
 *
 * Notas importantes:
 * - Se utilizan Signals de Angular para estado reactivo.
 * - Se reemplazan los "type assertions" en el template por `$any(...)` y `?.` para evitar
 *   errores de parseo en Angular templates y "Object is possibly 'null'".
 * - El componente es autocontenido para evitar dependencias externas que no tengas
 *   en tu proyecto. Si quieres integrar con servicios reales, reemplaza los métodos
 *   simulados `analyzeMerge()` y `performMerge()`.
 */

type MergeStep = 'selection' | 'analysis' | 'confirmation' | 'result';

export interface FlattenedAccount {
  id: string;
  code: string;
  name: string;
  type: 'HEADER' | 'POSTABLE';
}

export interface MergeAnalysis {
  ok: boolean;
  warnings: string[];
  transactionsToMove: number;
  sourceBalance: number;
  targetBalance: number;
}

@Component({
  selector: 'app-merge-tool',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './merge-tool.html',
  // Se omite styleUrls para evitar errores si el archivo SCSS no existe aún.
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MergeToolComponent {
  // --------------------------------------------------
  // Estado (Signals)
  // --------------------------------------------------
  readonly currentStep = signal<MergeStep>('selection');

  readonly sourceAccountQuery = signal<string>('');
  readonly targetAccountQuery = signal<string>('');

  readonly sourceAccountId = signal<string | null>(null);
  readonly targetAccountId = signal<string | null>(null);

  readonly errorMessage = signal<string | null>(null);
  readonly isAnalyzing = signal<boolean>(false);
  readonly isMerging = signal<boolean>(false);

  // Datos: en un proyecto real vendrían de un servicio/estado global.
  // Aquí se incluyen algunos ejemplos para que el componente funcione de forma autónoma.
  readonly allAccounts = signal<FlattenedAccount[]>([
    { id: '1', code: '100-01', name: 'Caja General', type: 'POSTABLE' },
    { id: '2', code: '100-02', name: 'Banco Principal', type: 'POSTABLE' },
    { id: '3', code: '100',    name: 'Efectivo y Equivalentes', type: 'HEADER' },
    { id: '4', code: '200-01', name: 'Cuentas por Cobrar', type: 'POSTABLE' },
    { id: '5', code: '300',    name: 'Ingresos', type: 'HEADER' },
    { id: '6', code: '300-01', name: 'Ingresos por Ventas', type: 'POSTABLE' },
  ]);

  // Solo cuentas "posteables" (no cabeceras)
  readonly postableAccounts = computed(() =>
    this.allAccounts().filter(a => a.type === 'POSTABLE')
  );

  // Opciones filtradas por búsqueda para cada select
  readonly sourceAccountOptions = computed(() => {
    const q = this.sourceAccountQuery().trim().toLowerCase();
    return this.postableAccounts().filter(a =>
      a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
    );
  });

  readonly targetAccountOptions = computed(() => {
    const q = this.targetAccountQuery().trim().toLowerCase();
    const excludeId = this.sourceAccountId();
    return this.postableAccounts().filter(a =>
      a.id !== excludeId &&
      (a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q))
    );
  });

  // Selecciones actuales
  readonly selectedSourceAccount = computed<FlattenedAccount | null>(() => {
    const id = this.sourceAccountId();
    return id ? this.allAccounts().find(a => a.id === id) ?? null : null;
  });

  readonly selectedTargetAccount = computed<FlattenedAccount | null>(() => {
    const id = this.targetAccountId();
    return id ? this.allAccounts().find(a => a.id === id) ?? null : null;
  });

  // Resultado del análisis y de la fusión
  readonly analysis = signal<MergeAnalysis | null>(null);
  readonly mergeSucceeded = signal<boolean | null>(null);

  // Reset automático de mensajes de error cuando cambia de paso
  private _clearErrorOnStepChange = effect(() => {
    this.currentStep();
    this.errorMessage.set(null);
  });

  // --------------------------------------------------
  // Acciones del Wizard
  // --------------------------------------------------
  goToSelection(): void {
    this.currentStep.set('selection');
  }

  async goToAnalysis(): Promise<void> {
    this.errorMessage.set(null);
    if (!this.sourceAccountId() || !this.targetAccountId()) {
      this.errorMessage.set('Selecciona la cuenta origen y la cuenta destino.');
      return;
    }
    if (this.sourceAccountId() === this.targetAccountId()) {
      this.errorMessage.set('La cuenta origen y destino no pueden ser la misma.');
      return;
    }
    await this.analyzeMerge();
  }

  goToConfirmation(): void {
    if (!this.analysis() || !this.analysis()?.ok) {
      this.errorMessage.set('El análisis no es válido o no ha terminado.');
      return;
    }
    this.currentStep.set('confirmation');
  }

  async confirmAndMerge(): Promise<void> {
    this.errorMessage.set(null);
    await this.performMerge();
  }

  reset(): void {
    this.sourceAccountQuery.set('');
    this.targetAccountQuery.set('');
    this.sourceAccountId.set(null);
    this.targetAccountId.set(null);
    this.analysis.set(null);
    this.mergeSucceeded.set(null);
    this.errorMessage.set(null);
    this.currentStep.set('selection');
  }

  // --------------------------------------------------
  // Simulaciones (reemplazar por servicios reales si procede)
  // --------------------------------------------------
  private async analyzeMerge(): Promise<void> {
    try {
      this.isAnalyzing.set(true);
      // Simula retardo de red
      await new Promise(r => setTimeout(r, 500));

      const src = this.selectedSourceAccount();
      const tgt = this.selectedTargetAccount();
      if (!src || !tgt) {
        this.errorMessage.set('Debes seleccionar cuentas válidas.');
        return;
      }

      // Resultado de ejemplo
      const result: MergeAnalysis = {
        ok: true,
        warnings: tgt.code.startsWith('100') ? [] : ['La cuenta destino no es del mismo grupo que origen.'],
        transactionsToMove: 42,
        sourceBalance: 1500.75,
        targetBalance: 3200.00,
      };
      this.analysis.set(result);
      this.currentStep.set('analysis');
    } catch (e: any) {
      this.errorMessage.set('No se pudo completar el análisis. Intenta nuevamente.');
    } finally {
      this.isAnalyzing.set(false);
    }
  }

  private async performMerge(): Promise<void> {
    try {
      this.isMerging.set(true);
      // Simula retardo de red
      await new Promise(r => setTimeout(r, 600));

      // Simula éxito
      this.mergeSucceeded.set(true);
      this.currentStep.set('result');
    } catch (e: any) {
      this.mergeSucceeded.set(false);
      this.errorMessage.set('La fusión falló. Revisa los datos e inténtalo de nuevo.');
      this.currentStep.set('result');
    } finally {
      this.isMerging.set(false);
    }
  }
}
