import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubsidiaryLedgersPage } from './subsidiary-ledgers.page';

describe('SubsidiaryLedgersPage', () => {
  let component: SubsidiaryLedgersPage;
  let fixture: ComponentFixture<SubsidiaryLedgersPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubsidiaryLedgersPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubsidiaryLedgersPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
