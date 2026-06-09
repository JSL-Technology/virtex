import { provideRouter } from "@angular/router";
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MyWorkPage } from './my-work.page';

describe('MyWork', () => {
  let component: MyWorkPage;
  let fixture: ComponentFixture<MyWorkPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])], imports: [MyWorkPage]
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
