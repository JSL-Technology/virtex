import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Checklist } from './checklist.page';

describe('Checklist', () => {
  let component: Checklist;
  let fixture: ComponentFixture<Checklist>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Checklist]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Checklist);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
