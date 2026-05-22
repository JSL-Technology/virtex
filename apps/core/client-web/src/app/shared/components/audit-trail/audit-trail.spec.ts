import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuditTrail } from './audit-trail';

describe('AuditTrail', () => {
  let component: AuditTrail;
  let fixture: ComponentFixture<AuditTrail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditTrail]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuditTrail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
