import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { DialogHostComponent } from './dialog-host.component';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * The prompt honours exactly the minimum its caller asked for. It used to demand at least one
 * character whatever the caller said, so «leave blank to use the customer's address» refused the
 * blank answer and the button did nothing (QA A2).
 */
describe('DialogHostComponent — prompt', () => {
  async function open(minLength?: number) {
    await TestBed.configureTestingModule({
      imports: [DialogHostComponent, TranslateModule.forRoot()],
    }).compileComponents();
    const fixture = TestBed.createComponent(DialogHostComponent);
    const dialogs = TestBed.inject(DialogService);
    const answer = dialogs.prompt({ title: 't', message: 'm', ...(minLength === undefined ? {} : { minLength }) });
    fixture.detectChanges();
    const host = fixture.componentInstance as unknown as {
      submitPrompt(): void;
      promptError(): boolean;
    };
    return { fixture, answer, host };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('accepts a blank answer when the caller allows one', async () => {
    const { host, answer } = await open(0);
    host.submitPrompt();
    await expect(answer).resolves.toBe('');
  });

  it('refuses a blank answer by default, and says why', async () => {
    const { host, fixture } = await open();
    host.submitPrompt();
    fixture.detectChanges();
    expect(host.promptError()).toBe(true);
    const error: HTMLElement = document.querySelector('.dialog-error') as HTMLElement;
    expect(error?.textContent?.trim()).toBe('dialog.prompt.required');
  });

  it('labels the field with the question instead of repeating it', async () => {
    const { fixture } = await open(0);
    fixture.detectChanges();
    const input = document.querySelector('.dialog-input') as HTMLInputElement;
    const message = document.querySelector('.dialog-message') as HTMLElement;
    expect(input.getAttribute('aria-labelledby')).toBe(message.id);
    expect(document.querySelectorAll('.sr-only').length).toBe(0);
  });
});
