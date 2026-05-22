import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MyWork } from './my-work';

describe('MyWork', () => {
  let component: MyWork;
  let fixture: ComponentFixture<MyWork>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyWork]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MyWork);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
