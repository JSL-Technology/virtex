import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlertsPanel } from './alerts-panel';

describe('AlertsPanel', () => {
  let component: AlertsPanel;
  let fixture: ComponentFixture<AlertsPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlertsPanel]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AlertsPanel);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
