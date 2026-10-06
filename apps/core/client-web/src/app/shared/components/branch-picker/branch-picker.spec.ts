import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { BranchesService, MyBranches } from '../../../core/tenancy/branches.service';
import { VxBranchLabelComponent } from './branch-label.component';
import { VxBranchPickerComponent } from './branch-picker.component';

/**
 * The branch picker's rules are the ones every document form relies on, so they are tested once
 * here: invisible for a company without branches, the server's own default proposed on a new
 * document, a single allowed branch shown rather than offered, and «all my branches» as a filter.
 */
class FakeBranches {
  readonly state = signal<MyBranches>({ branches: [], closed: [], defaultBranchId: null, restricted: false });
  readonly mine = this.state.asReadonly();
  readonly hasBranches = () => this.state().branches.length > 0;
  ensureMine = jest.fn(() => Promise.resolve(this.state()));
  label(id: string | null | undefined): string | null {
    const all = [...this.state().branches, ...this.state().closed];
    const branch = all.find((b) => b.id === id);
    return branch ? `${branch.code} · ${branch.name}` : null;
  }
}

const HQ = { id: 'hq', code: 'MATRIZ', name: 'Casa matriz', isHeadquarters: true };
const STORE = { id: 'st', code: 'STI', name: 'Santiago', isHeadquarters: false };

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, VxBranchPickerComponent, VxBranchLabelComponent],
  template: `
    <vx-branch-picker class="field-picker" [formControl]="field" />
    <vx-branch-picker class="filter-picker" mode="filter" [(ngModel)]="filter" />
    <vx-branch-picker class="optional-picker" [optional]="true" [formControl]="optionalField" />
    <vx-branch-label class="label" [branchId]="labelled" />
  `,
})
class Host {
  readonly field = new FormControl<string | null>(null);
  readonly optionalField = new FormControl<string | null>(null);
  filter: string | null = null;
  labelled: string | null = 'old';
}

describe('VxBranchPickerComponent', () => {
  let fixture: ComponentFixture<Host>;
  let branches: FakeBranches;
  let el: HTMLElement;

  beforeEach(() => {
    branches = new FakeBranches();
    TestBed.configureTestingModule({
      imports: [Host, TranslateModule.forRoot()],
      providers: [{ provide: BranchesService, useValue: branches }],
    });
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
  });

  const host = (selector: string) => el.querySelector(selector) as HTMLElement;

  it('is not there at all for a company without branches', fakeAsync(() => {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
    expect(host('.field-picker').hidden).toBe(true);
    expect(host('.filter-picker').hidden).toBe(true);
    expect(fixture.componentInstance.field.value).toBeNull();
  }));

  it('starts a new document on the person\'s default branch', fakeAsync(() => {
    branches.state.set({ branches: [HQ, STORE], closed: [], defaultBranchId: 'st', restricted: false });
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();

    expect(host('.field-picker').hidden).toBe(false);
    expect(fixture.componentInstance.field.value).toBe('st');
    // A filter never proposes anything: empty means every branch.
    expect(fixture.componentInstance.filter).toBeNull();
    // A field that may stay without a branch proposes nothing either.
    expect(fixture.componentInstance.optionalField.value).toBeNull();
  }));

  it('falls back to the headquarters, and keeps a branch the document already has', fakeAsync(() => {
    fixture.componentInstance.field.setValue('st');
    branches.state.set({ branches: [HQ, STORE], closed: [], defaultBranchId: null, restricted: false });
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
    expect(fixture.componentInstance.field.value).toBe('st');

    const fresh = TestBed.createComponent(Host);
    fresh.detectChanges();
    flushMicrotasks();
    fresh.detectChanges();
    expect(fresh.componentInstance.field.value).toBe('hq');
  }));

  it('shows a single allowed branch instead of offering it, and hides the filter', fakeAsync(() => {
    branches.state.set({ branches: [STORE], closed: [], defaultBranchId: null, restricted: true });
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();

    expect(host('.field-picker').querySelector('output')?.textContent).toContain('STI · Santiago');
    expect(host('.field-picker').querySelector('select')).toBeNull();
    expect(fixture.componentInstance.field.value).toBe('st');
    expect(host('.filter-picker').hidden).toBe(true);
  }));

  it('offers «all my branches» as a filter and reports the choice', fakeAsync(() => {
    branches.state.set({ branches: [HQ, STORE], closed: [], defaultBranchId: null, restricted: false });
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();

    const select = host('.filter-picker').querySelector('select') as HTMLSelectElement;
    expect(select.options[0].value).toBe('');
    select.value = 'hq';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    flushMicrotasks();
    expect(fixture.componentInstance.filter).toBe('hq');
  }));

  it('names a closed branch on the documents it issued', fakeAsync(() => {
    branches.state.set({ branches: [HQ], closed: [{ id: 'old', code: 'OLD', name: 'Cerrada' }], defaultBranchId: null, restricted: false });
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
    expect(host('.label').textContent).toContain('OLD · Cerrada');
  }));
});
