import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MyWorkPage } from './my-work.page';

describe('MyWorkPage', () => {
  let component: MyWorkPage;
  let fixture: ComponentFixture<MyWorkPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyWorkPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MyWorkPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
