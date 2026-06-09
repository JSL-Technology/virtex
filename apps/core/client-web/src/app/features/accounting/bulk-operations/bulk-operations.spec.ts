import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BulkOperationsComponent } from './bulk-operations';

describe('BulkOperations', () => {
  let component: BulkOperationsComponent;
  let fixture: ComponentFixture<BulkOperationsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BulkOperationsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BulkOperationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
