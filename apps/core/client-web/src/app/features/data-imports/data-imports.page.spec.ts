import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataImportsPage } from './data-imports.page';

describe('DataImportsPage', () => {
  let component: DataImportsPage;
  let fixture: ComponentFixture<DataImportsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataImportsPage]
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
