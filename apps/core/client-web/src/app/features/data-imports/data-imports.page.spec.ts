import { provideRouter } from "@angular/router";
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataImportsPage } from './data-imports.page';

describe('DataImports', () => {
  let component: DataImportsPage;
  let fixture: ComponentFixture<DataImportsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])], imports: [DataImportsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataImportsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
