import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MergeToolComponent } from './merge-tool';

describe('MergeToolComponent', () => {
  let component: MergeToolComponent;
  let fixture: ComponentFixture<MergeToolComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MergeToolComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MergeToolComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
