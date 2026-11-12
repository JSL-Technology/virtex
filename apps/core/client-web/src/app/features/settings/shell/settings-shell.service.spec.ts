import { signal } from '@angular/core';
import { SettingsChanges, SettingsShellService } from './settings-shell.service';

/** A section built from several forms is asked about, saved and dropped as one. */
describe('SettingsShellService', () => {
  function form(dirty = false, saves = true) {
    const state = signal(dirty);
    const changes: SettingsChanges & { state: typeof state; save: jest.Mock; discard: jest.Mock } = {
      state,
      dirty: state,
      save: jest.fn(async () => {
        if (saves) state.set(false);
        return saves;
      }),
      discard: jest.fn(() => state.set(false)),
    };
    return changes;
  }

  it('is dirty while any registered form is', () => {
    const shell = new SettingsShellService();
    const a = form();
    const b = form();
    shell.register(a);
    shell.register(b);
    expect(shell.dirty()).toBe(false);
    b.state.set(true);
    expect(shell.dirty()).toBe(true);
    shell.unregister(b);
    expect(shell.dirty()).toBe(false);
  });

  it('saves only the forms with edits, and reports a failure', async () => {
    const shell = new SettingsShellService();
    const clean = form(false);
    const edited = form(true);
    shell.register(clean);
    shell.register(edited);
    expect(await shell.save()).toBe(true);
    expect(clean.save).not.toHaveBeenCalled();
    expect(edited.save).toHaveBeenCalledTimes(1);

    const failing = form(true, false);
    shell.register(failing);
    expect(await shell.save()).toBe(false);
  });

  it('drops every pending edit, and forgets the forms when the section leaves', () => {
    const shell = new SettingsShellService();
    const a = form(true);
    const b = form(true);
    shell.register(a);
    shell.register(b);
    shell.discard();
    expect(a.discard).toHaveBeenCalled();
    expect(b.discard).toHaveBeenCalled();
    a.state.set(true);
    shell.reset();
    expect(shell.dirty()).toBe(false);
  });

  it('cannot save from outside when a form with edits has no save', () => {
    const shell = new SettingsShellService();
    const state = signal(true);
    shell.register({ dirty: state });
    expect(shell.canSave()).toBe(false);
  });
});
