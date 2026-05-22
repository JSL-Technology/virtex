import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Documents } from './documents.page';

describe('Documents', () => {
  let component: Documents;
  let fixture: ComponentFixture<Documents>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Documents]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Documents);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
