import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RequisitionsPage } from './requisitions.page';

describe('Requisitions', () => {
  let component: RequisitionsPage;
  let fixture: ComponentFixture<RequisitionsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequisitionsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RequisitionsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
