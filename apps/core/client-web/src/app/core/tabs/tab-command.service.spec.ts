import { TestBed } from '@angular/core/testing';
import { TabCommandsService, TabLayoutController } from './tab-command.service';
import { TabStateService } from './tab-state.service';
import { TabPreferencesService } from './tab-preferences.service';

describe('TabCommandsService', () => {
  let calls: string[];
  let service: TabCommandsService;

  const tabStateStub = {
    activeTabId: () => 'a',
    tabs: () => [{ id: 'a', isPinned: false }],
    closeActive: () => calls.push('closeActive'),
    reopenLastClosed: () => calls.push('reopen'),
    activateRelative: (d: number) => calls.push(`rel:${d}`),
    closeOthers: (id: string) => calls.push(`others:${id}`),
    closeToRight: (id: string) => calls.push(`right:${id}`),
    closeAll: () => calls.push('all'),
    duplicateTab: (id: string) => calls.push(`dup:${id}`),
    pinTab: (id: string) => calls.push(`pin:${id}`),
    unpinTab: (id: string) => calls.push(`unpin:${id}`),
  };
  const prefsStub = { toggleEnablePreview: () => calls.push('preview') };

  beforeEach(() => {
    calls = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabStateService, useValue: tabStateStub },
        { provide: TabPreferencesService, useValue: prefsStub },
      ],
    });
    service = TestBed.inject(TabCommandsService);
  });

  it('runs each state action on the active tab', () => {
    expect(service.run('tabs.close')).toBe(true);
    service.run('tabs.close_others');
    service.run('tabs.close_right');
    service.run('tabs.duplicate');
    service.run('tabs.pin');
    service.run('tabs.preview_toggle');
    expect(calls).toEqual(['closeActive', 'others:a', 'right:a', 'dup:a', 'pin:a', 'preview']);
  });

  it('refuses a layout action until a controller is registered, then forwards it', () => {
    // No Dockview controller yet: nothing to act on, so the keystroke is left alone.
    expect(service.run('layout.split_right')).toBe(false);

    const seen: string[] = [];
    const controller: TabLayoutController = {
      splitActive: (d) => seen.push(`split:${d}`),
      floatActive: () => seen.push('float'),
      popoutActive: () => seen.push('popout'),
      toggleMaximizeActive: () => seen.push('max'),
    };
    service.registerLayout(controller);

    expect(service.run('layout.split_below')).toBe(true);
    expect(service.run('layout.maximize')).toBe(true);
    expect(seen).toEqual(['split:below', 'max']);
  });
});
