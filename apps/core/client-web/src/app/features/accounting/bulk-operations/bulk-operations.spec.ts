import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BulkOperations } from './bulk-operations';

describe('BulkOperations', () => {
  let component: BulkOperations;
  let fixture: ComponentFixture<BulkOperations>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BulkOperations]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BulkOperations);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
