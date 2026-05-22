import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TransactionFlow } from './transaction-flow';

describe('TransactionFlow', () => {
  let component: TransactionFlow;
  let fixture: ComponentFixture<TransactionFlow>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionFlow]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TransactionFlow);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
