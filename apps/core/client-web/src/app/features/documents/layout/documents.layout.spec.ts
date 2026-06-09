import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DocumentsLayout } from './documents.layout';

describe('Layout', () => {
  let component: DocumentsLayout;
  let fixture: ComponentFixture<DocumentsLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentsLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DocumentsLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
