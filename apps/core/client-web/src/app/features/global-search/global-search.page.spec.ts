import { provideRouter } from "@angular/router";
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GlobalSearchPage } from './global-search.page';

describe('GlobalSearch', () => {
  let component: GlobalSearchPage;
  let fixture: ComponentFixture<GlobalSearchPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])], imports: [GlobalSearchPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GlobalSearchPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
