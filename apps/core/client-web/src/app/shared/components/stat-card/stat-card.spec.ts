import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatCard } from './stat-card';

describe('StatCard', () => {
  let component: StatCard;
  let fixture: ComponentFixture<StatCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatCard]
    })
    .compileComponents();

    fixture = TestBed.createComponent(StatCard);
    component = fixture.componentInstance;
    // The card resolves its icon from `data.iconName`; with the default empty object the lucide
    // component throws "No icon name or image has been provided" during change detection.
    fixture.componentRef.setInput('data', {
      title: 'Ventas de Hoy',
      value: '$1,250.00',
      change: '+15%',
      iconName: 'DollarSign',
      color: 'blue',
    });
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
