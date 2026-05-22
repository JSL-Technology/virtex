import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SegmentConfigurationPage } from './segment-configuration.page';
import { ChartOfAccountsApiService } from '../../../../core/api/chart-of-accounts.service';
import { NotificationService } from '../../../../core/services/notification';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ReactiveFormsModule } from '@angular/forms';
import { LucideAngularModule, Save, Plus, Trash2, ArrowLeft, RotateCcw } from 'lucide-angular';

describe('SegmentConfigurationPage', () => {
  let component: SegmentConfigurationPage;
  let fixture: ComponentFixture<SegmentConfigurationPage>;
  let apiService: jest.Mocked<ChartOfAccountsApiService>;
  let notificationService: jest.Mocked<NotificationService>;
  let router: jest.Mocked<Router>;

  beforeEach(async () => {
    const apiSpy = {
      getSegmentDefinitions: jest.fn().mockReturnValue(of([])),
      configureSegmentDefinitions: jest.fn(),
      initializeDefaultSegments: jest.fn(),
    };
    const notificationSpy = {
      showError: jest.fn(),
      showSuccess: jest.fn(),
    };
    const routerSpy = {
      navigate: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        ReactiveFormsModule,
        LucideAngularModule.pick({ Save, Plus, Trash2, ArrowLeft, RotateCcw }),
        SegmentConfigurationPage
      ],
      providers: [
        { provide: ChartOfAccountsApiService, useValue: apiSpy },
        { provide: NotificationService, useValue: notificationSpy },
        { provide: Router, useValue: routerSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SegmentConfigurationPage);
    component = fixture.componentInstance;
    apiService = TestBed.inject(ChartOfAccountsApiService) as jest.Mocked<ChartOfAccountsApiService>;
    notificationService = TestBed.inject(NotificationService) as jest.Mocked<NotificationService>;
    router = TestBed.inject(Router) as jest.Mocked<Router>;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load segment definitions on init', () => {
    const mockDefs = [{ name: 'Level 1', length: 1, isRequired: true, order: 0 }];
    apiService.getSegmentDefinitions.mockReturnValue(of(mockDefs));

    component.ngOnInit();

    expect(apiService.getSegmentDefinitions).toHaveBeenCalled();
    expect(component.segments.length).toBe(1);
    expect(component.segments.at(0).value.name).toBe('Level 1');
  });

  it('should add a new segment', () => {
    component.addSegment();
    expect(component.segments.length).toBe(1);
  });

  it('should remove a segment', () => {
    component.addSegment();
    component.addSegment();
    expect(component.segments.length).toBe(2);
    component.removeSegment(0);
    expect(component.segments.length).toBe(1);
  });

  it('should save configuration successfully', () => {
    component.addSegment();
    component.segments.at(0).patchValue({ name: 'Test', length: 3 });
    apiService.configureSegmentDefinitions.mockReturnValue(of([]));

    component.onSave();

    expect(apiService.configureSegmentDefinitions).toHaveBeenCalled();
    expect(notificationService.showSuccess).toHaveBeenCalledWith('Estructura de segmentos guardada correctamente.');
    expect(router.navigate).toHaveBeenCalledWith(['/accounting/chart-of-accounts']);
  });

  it('should handle save error', () => {
    component.addSegment();
    component.segments.at(0).patchValue({ name: 'Test', length: 3 });
    apiService.configureSegmentDefinitions.mockReturnValue(throwError(() => ({ error: { message: 'Error' } })));

    component.onSave();

    expect(notificationService.showError).toHaveBeenCalledWith('Error');
  });
});
