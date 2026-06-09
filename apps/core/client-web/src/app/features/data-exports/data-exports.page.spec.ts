import { provideRouter } from "@angular/router";
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataExportsPage } from './data-exports.page';

describe('DataExports', () => {
  let component: DataExportsPage;
  let fixture: ComponentFixture<DataExportsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])], imports: [DataExportsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataExportsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
