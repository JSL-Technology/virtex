import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubsidiaryLedgers } from './subsidiary-ledgers.page';

describe('SubsidiaryLedgers', () => {
  let component: SubsidiaryLedgers;
  let fixture: ComponentFixture<SubsidiaryLedgers>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubsidiaryLedgers]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubsidiaryLedgers);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
