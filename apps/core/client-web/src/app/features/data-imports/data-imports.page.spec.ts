import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataImports } from './data-imports.page';

describe('DataImports', () => {
  let component: DataImports;
  let fixture: ComponentFixture<DataImports>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataImports]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataImports);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
