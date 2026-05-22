
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth';
import { API_URL } from '../tokens/api-url.token';
import { NotificationService } from './notification';
import { WebSocketService } from './websocket.service';
import { ModalService } from '../../shared/service/modal.service';
import { ErrorHandlerService } from './error-handler.service';
import { Subject } from 'rxjs';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const mockRouter = {
    navigate: jest.fn(),
    navigateByUrl: jest.fn().mockResolvedValue(true),
  };

  const mockNotificationService = {
    showSuccess: jest.fn(),
    showError: jest.fn(),
  };

  const mockWebSocketService = {
    connectionReady$: new Subject(),
    connect: jest.fn(),
    emit: jest.fn(),
    listen: jest.fn().mockReturnValue(new Subject()),
    disconnect: jest.fn(),
  };

  const mockModalService = {
    open: jest.fn(),
  };

  const mockErrorHandlerService = {
    handleError: jest.fn().mockImplementation((op, err) => { throw err; }),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: API_URL, useValue: 'http://test-api/v1' },
        { provide: Router, useValue: mockRouter },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: WebSocketService, useValue: mockWebSocketService },
        { provide: ModalService, useValue: mockModalService },
        { provide: ErrorHandlerService, useValue: mockErrorHandlerService },
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have correct API URL', () => {
    // Access private property if needed for testing, or test side effects
    // Since apiUrl is private, we can verify calls to it
    service.login({ email: 'test@test.com', password: '123', recaptchaToken: 'token' }).subscribe();
    const req = httpMock.expectOne('http://test-api/v1/auth/login');
    expect(req.request.method).toBe('POST');
  });
});
