import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BestClients } from './best-clients';

describe('BestClients', () => {
  let component: BestClients;
  let fixture: ComponentFixture<BestClients>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BestClients]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BestClients);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
