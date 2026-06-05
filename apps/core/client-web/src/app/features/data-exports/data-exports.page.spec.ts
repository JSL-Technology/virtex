import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataExportsPage } from './data-exports.page';

describe('DataExportsPage', () => {
  let component: DataExportsPage;
  let fixture: ComponentFixture<DataExportsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataExportsPage]
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
