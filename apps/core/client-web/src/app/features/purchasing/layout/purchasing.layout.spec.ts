import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PurchasingLayout } from './purchasing.layout';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';

describe('PurchasingLayout', () => {
  let component: PurchasingLayout;
  let fixture: ComponentFixture<PurchasingLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PurchasingLayout, TranslateModule.forRoot()],
      providers: [provideRouter([])]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PurchasingLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
