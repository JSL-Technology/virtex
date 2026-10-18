import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { DataImportsPage } from './data-imports.page';
import { ColumnMappingProposal, DataTransferService } from '../../core/api/data-transfer.service';
import { NotificationService } from '../../core/services/notification';

const proposal = (overrides: Partial<ColumnMappingProposal> = {}): ColumnMappingProposal => ({
  headers: ['nombre del cliente', 'rnc', 'notas'],
  sample: [{ 'nombre del cliente': 'Peña SRL', rnc: '101123456', notas: 'vip' }],
  mapping: { 'nombre del cliente': 'name', rnc: 'tax_id', notas: null },
  source: 'ai',
  missing: [],
  columns: [
    { key: 'name', required: true },
    { key: 'tax_id', required: false },
  ],
  ...overrides,
});

describe('DataImportsPage', () => {
  let component: DataImportsPage;
  let fixture: ComponentFixture<DataImportsPage>;
  let api: Record<string, jest.Mock>;

  const choose = (file: File) => component.onFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
  const csv = () => new File(['nombre del cliente,rnc\nPeña SRL,101123456'], 'clientes.csv', { type: 'text/csv' });

  const setup = async (detected: ColumnMappingProposal) => {
    api = {
      datasets: jest.fn().mockReturnValue(
        of([
          { id: 'customers', labelKey: 'x', importable: true, columns: [] },
          { id: 'opening_balances', labelKey: 'y', hintKey: 'data_transfer.hints.opening_balances', importable: true, columns: [] },
        ]),
      ),
      runs: jest.fn().mockReturnValue(of([])),
      columnMapping: jest.fn().mockReturnValue(of(detected)),
      import: jest.fn().mockReturnValue(of({ runId: 'r', status: 'VALIDATED', totalRows: 1, importedRows: 0, failedRows: 0, problems: [] })),
      template: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [DataImportsPage],
      providers: [
        provideRouter([]),
        { provide: DataTransferService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showError: jest.fn(), showSuccess: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DataImportsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedDatasetId.set('customers');
  };

  it('says what to know before importing a dataset that has rules a template cannot show', async () => {
    await setup(proposal({ source: 'template', mapping: {} }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dataset-hint')).toBeNull();

    component.selectedDatasetId.set('opening_balances');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dataset-hint')?.textContent).toContain('data_transfer.hints.opening_balances');
  });

  it('imports a template file as it is, without a mapping', async () => {
    await setup(proposal({ source: 'template', mapping: { name: 'name' } }));
    choose(csv());
    expect(component.needsMapping()).toBe(false);
    component.run('validate');
    expect(api['import']).toHaveBeenCalledWith('customers', expect.any(File), 'validate', null);
  });

  it('shows the proposed mapping for another file, and sends what the person confirmed', async () => {
    await setup(proposal());
    choose(csv());
    expect(api['columnMapping']).toHaveBeenCalledWith('customers', expect.any(File));
    expect(component.needsMapping()).toBe(true);

    component.setMapping('notas', 'tax_id');
    // One header per field: the field moved from «rnc» to «notas».
    expect(component.mapping()).toEqual({ 'nombre del cliente': 'name', rnc: null, notas: 'tax_id' });

    component.run('validate');
    expect(api['import']).toHaveBeenCalledWith('customers', expect.any(File), 'validate', { 'nombre del cliente': 'name', rnc: null, notas: 'tax_id' });
  });

  it('says which required fields are still unmapped', async () => {
    await setup(proposal());
    choose(csv());
    component.setMapping('nombre del cliente', '');
    expect(component.missingRequired()).toEqual(['name']);
  });
});
