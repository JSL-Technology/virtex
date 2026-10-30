import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { TerminalConfigService } from '../../../core/terminal-config.service';
import { ToastService } from '../../../core/toast.service';
import { TillStore } from '../../../state/till.store';
import { SettingsDialogComponent } from './settings-dialog.component';

/** POS-01 / POS-02 / POS-04: the till's settings say what is wrong, keep to settings, and say where they live. */
describe('SettingsDialogComponent', () => {
  const till = { shiftReady: signal(false), switchTerminal: jest.fn() };
  const toast = { success: jest.fn() };

  function create() {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [SettingsDialogComponent],
      providers: [provideTranslateService(), { provide: TillStore, useValue: till }, { provide: ToastService, useValue: toast }],
    });
    const fixture = TestBed.createComponent(SettingsDialogComponent);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => jest.clearAllMocks());

  it('says why an identifier is refused, under the field, instead of only greying the button', () => {
    const { fixture, root } = create();
    const input = root.querySelector('#pos-terminal-id') as HTMLInputElement;
    input.value = 'CAJA 1 ñ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const error = root.querySelector('#pos-terminal-error');
    expect(error?.textContent).toContain('pos.settings.terminal_invalid');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('pos-terminal-error');
  });

  it('saves a valid identifier for this device and switches the till', () => {
    const { fixture, root } = create();
    const input = root.querySelector('#pos-terminal-id') as HTMLInputElement;
    input.value = 'CAJA-2';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('.btn-primary') as HTMLButtonElement).click();
    expect(till.switchTerminal).toHaveBeenCalledWith('CAJA-2');
    expect(toast.success).toHaveBeenCalled();
  });

  it('does not switch the till when the identifier is invalid', () => {
    const { fixture, root } = create();
    const input = root.querySelector('#pos-terminal-id') as HTMLInputElement;
    input.value = 'a b';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('.btn-primary') as HTMLButtonElement).click();
    expect(till.switchTerminal).not.toHaveBeenCalled();
  });

  it('keeps the shortcuts out, linked, and says the settings live on this device', () => {
    const { fixture, root } = create();
    expect(root.querySelector('kbd')).toBeNull();
    expect(root.querySelector('.note')?.textContent).toContain('pos.settings.device_note');
    const opened = jest.fn();
    fixture.componentInstance.showShortcuts.subscribe(opened);
    (root.querySelector('.link') as HTMLButtonElement).click();
    expect(opened).toHaveBeenCalled();
    expect(TestBed.inject(TerminalConfigService).terminalId()).toBe('main');
  });
});
