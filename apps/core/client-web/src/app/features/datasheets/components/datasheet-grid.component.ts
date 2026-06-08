
import {
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotTableComponent } from '@handsontable/angular-wrapper';
import { registerAllModules } from 'handsontable/registry';
import Handsontable from 'handsontable';
import HyperFormula from 'hyperformula';
import { DatasheetVariablesService } from '../services/datasheet-variables.service';
import { firstValueFrom } from 'rxjs';

// Register Handsontable modules
registerAllModules();

@Component({
  selector: 'app-datasheet-grid',
  standalone: true,
  imports: [CommonModule, HotTableComponent],
  template: `
    <hot-table
      [settings]="hotSettings"
      class="w-full h-full"
    ></hot-table>
  `,
  styleUrls: [],
  encapsulation: ViewEncapsulation.None
})
export class DatasheetGridComponent implements OnInit, OnDestroy {
  @Input() id = 'hot-editor';

  private hfInstance: any;
  private erpVariables: any[] = [];
  private resolvedValues: Record<string, any> = {};

  constructor(private variablesService: DatasheetVariablesService) {}
  @Input() data: any[][] = [
    ['', '', '', ''],
    ['', '', '', ''],
    ['', '', '', '']
  ];

  hotSettings: any = {
    data: this.data,
    colHeaders: true,
    rowHeaders: true,
    height: '100%',
    width: '100%',
    licenseKey: 'non-commercial-and-evaluation',
    formulas: {
      engine: HyperFormula,
      sheetName: 'Sheet1'
    },
    cells: (row: number, col: number) => {
       const cellProperties: any = {};
       cellProperties.renderer = this.customRenderer.bind(this);
       return cellProperties;
    },
    beforeBeginEditing: (row: number, col: number) => {
       const hot = (window as any).Handsontable.getInstance(document.getElementById(this.id));
       const value = hot.getSourceDataAtCell(row, col);
       if (typeof value === 'string' && value.startsWith('=')) {
          // Check if it's an ERP variable
          if (this.isERPVariableFormula(value)) {
             alert('Este valor proviene del ERP y no puede editarse aquí.');
             return false;
          }
       }
       return true;
    },
    contextMenu: true,
    manualColumnResize: true,
    manualRowResize: true,
    autoWrapRow: true,
    autoWrapCol: true,
    stretchH: 'all'
  };

  private customRenderer(instance: any, td: HTMLElement, row: number, col: number, prop: string | number, value: any, cellProperties: any) {
    Handsontable.renderers.TextRenderer.apply(this, [instance, td, row, col, prop, value, cellProperties]);

    const sourceValue = instance.getSourceDataAtCell(row, col);
    if (typeof sourceValue === 'string' && this.isERPVariableFormula(sourceValue)) {
      td.style.color = '#2563eb'; // Blue-600
      td.style.fontWeight = '500';
    }

    if (String(value).startsWith('#')) {
      td.style.color = '#dc2626'; // Red-600
    }
  }

  private isERPVariableFormula(formula: string): boolean {
    if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) return false;
    const upperFormula = formula.toUpperCase();
    return this.erpVariables.some(v =>
      upperFormula.includes(v.nameEn.toUpperCase()) ||
      upperFormula.includes(v.nameEs.toUpperCase())
    );
  }

  async ngOnInit(): Promise<void> {
    await this.registerERPFuntions();
  }

  setCellFormula(formula: string) {
     const hot = (window as any).Handsontable.getInstance(document.getElementById(this.id));
     const selected = hot.getSelected() || [[0, 0]];
     const [row, col] = selected[0];
     hot.setDataAtCell(row, col, formula);
  }

  private async registerERPFuntions() {
    const variables = await firstValueFrom(this.variablesService.getVariables());
    this.erpVariables = variables;

    variables.forEach(v => {
      const names = [v.nameEn.toUpperCase(), v.nameEs.toUpperCase()];

      names.forEach(name => {
        try {
          (HyperFormula as any).registerFunction(name, {
            method: (ast: any, formulaAddress: any, hyperFormula: any, ...args: any[]) => {
              const key = `${name}${args.length ? '(' + args.map(a => '"' + a + '"').join(',') + ')' : ''}`;
              return this.resolvedValues[key] ?? '#CARGANDO...';
            },
            isFunctionAsync: false,
            parameters: (v.params || []).map(() => ({ argumentType: 'ANY' }))
          });
        } catch (e) {}
      });
    });

    // Register IMPORTAR functions
    ['IMPORTAR_PRODUCTOS', 'IMPORTAR_CLIENTES', 'IMPORTAR_VENTAS'].forEach(fnName => {
       try {
          (HyperFormula as any).registerFunction(fnName, {
            method: (ast: any, formulaAddress: any, hyperFormula: any, ...args: any[]) => {
              const key = `${fnName}(${args.map(a => '"' + a + '"').join(',')})`;
              const data = this.resolvedValues[key];
              if (data && Array.isArray(data)) {
                return data;
              }
              return '#CARGANDO_DATOS...';
            },
            isFunctionAsync: false,
            parameters: [{ argumentType: 'ANY', amount: { min: 1, max: 20 } }]
          });
       } catch (e) {}
    });
  }

  async refreshData() {
    const hot = (window as any).Handsontable.getInstance(document.getElementById(this.id));
    const formulas = hot.getData().flat().filter((v: any) => typeof v === 'string' && v.startsWith('='));

    const varsToResolve: any[] = [];
    formulas.forEach((f: string) => {
      const match = f.match(/=([A-Z_0-9]+)(?:\((.*)\))?/i);
      if (match) {
        const name = match[1];
        const params = match[2] ? match[2].split(',').map(p => p.trim().replace(/['"]/g, '')) : [];
        varsToResolve.push({ name, params });
      }
    });

    if (varsToResolve.length > 0) {
      this.resolvedValues = await firstValueFrom(this.variablesService.resolveVariables(varsToResolve));
      hot.render(); // Force re-render to show new values
    }
  }

  ngOnDestroy(): void {
    // Cleanup logic
  }
}
