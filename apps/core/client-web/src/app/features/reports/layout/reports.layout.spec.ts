import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportsLayout } from './reports.layout';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';

describe('ReportsLayout', () => {
  let component: ReportsLayout;
  let fixture: ComponentFixture<ReportsLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportsLayout, TranslateModule.forRoot()],
      providers: [provideRouter([])]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ReportsLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
