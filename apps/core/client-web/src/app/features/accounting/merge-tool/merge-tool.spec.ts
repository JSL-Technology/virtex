import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MergeTool } from './merge-tool';

describe('MergeTool', () => {
  let component: MergeTool;
  let fixture: ComponentFixture<MergeTool>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MergeTool]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MergeTool);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
