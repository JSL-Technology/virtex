import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataExports } from './data-exports.page';

describe('DataExports', () => {
  let component: DataExports;
  let fixture: ComponentFixture<DataExports>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataExports]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataExports);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
