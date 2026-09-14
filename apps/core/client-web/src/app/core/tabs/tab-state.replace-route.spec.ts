import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { TabStateService } from './tab-state.service';
import { TabRegistryService } from './tab-registry.service';
import { TabPreferencesService } from './tab-preferences.service';
import { DialogService } from '../services/dialog.service';
import { NotificationService } from '../services/notification';
import { TabEventBusService } from './tab-event-bus.service';
import { TranslateService } from '@ngx-translate/core';
import { TabType, TabDefinition } from './tab.model';

/**
 * A draft that has been saved is no longer a draft, and the workspace has to agree.
 *
 * Saving a new employee left the window titled "New employee", keyed `employee:new`, on the URL
 * `/hcm/employees/new`. Reloading that URL — or sharing it — reopened an EMPTY form, which read as
 * the reader's own unsaved work and invited a second save of a record that already existed.
 *
 * Navigating to the record's route is not the fix: that leaves the draft window open and puts the
 * record in a second one beside it. The window has to change identity in place, which is what
 * `replaceRoute` does and what these assertions pin down.
 */

const draftDef: TabDefinition = {
  pattern: '/employees/new',
  tabType: TabType.WIZARD,
  icon: 'UserPlus',
  title: 'page_titles.employee_new',
  isCloseable: true,
  entityKeyFn: () => 'employee:new',
  load: () => Promise.resolve(class {}),
};

const recordDef: TabDefinition = {
  pattern: '/employees/:id/edit',
  tabType: TabType.RECORD,
  icon: 'UsersRound',
  title: 'page_titles.employee_edit',
  isCloseable: true,
  entityKeyFn: (p) => `employee:${p['id']}`,
  load: () => Promise.resolve(class {}),
};

const listDef: TabDefinition = {
  pattern: '/employees',
  tabType: TabType.MODULE_LIST,
  icon: 'List',
  title: 'page_titles.employees',
  isCloseable: true,
  entityKeyFn: () => 'module:/employees',
  load: () => Promise.resolve(class {}),
};

function resolve(route: string) {
  if (route === '/employees/new') return { definition: draftDef, params: {}, isFallback: false };
  const match = route.match(/^\/employees\/([\w-]+)\/edit$/);
  if (match) {
    return { definition: recordDef, params: { id: match[1] }, isFallback: false };
  }
  return { definition: listDef, params: {}, isFallback: false };
}

describe('TabStateService — a saved draft takes over its own window', () => {
  let tabs: TabStateService;
  const enablePreview = signal(false);

  beforeEach(() => {
    enablePreview.set(false);
    TestBed.configureTestingModule({
      providers: [
        TabStateService,
        { provide: TabRegistryService, useValue: { resolve, canOpen: () => true } },
        { provide: TabPreferencesService, useValue: { enablePreview } },
        { provide: DialogService, useValue: { confirmClose: () => Promise.resolve('discard') } },
        { provide: NotificationService, useValue: { showWarning: jest.fn(), showInfo: jest.fn() } },
        { provide: TabEventBusService, useValue: { on: () => of(), emit: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
      ],
    });
    tabs = TestBed.inject(TabStateService);
  });

  /** Opens the "new employee" draft and dirties it, as typing into it would. */
  const draft = () => {
    tabs.openTab({ route: '/employees/new' });
    const tab = tabs.tabs().find((t) => t.route === '/employees/new');
    if (!tab) throw new Error('the draft window did not open');
    tabs.markDirty(tab.id);
    return tab;
  };

  it('changes route, title and entity in place instead of opening a second window', () => {
    const tab = draft();

    tabs.replaceRoute(tab.id, '/employees/e-1/edit', { title: 'Ana Reyes' });

    expect(tabs.tabs().length).toBe(1);
    const after = tabs.tabs()[0];
    expect(after.id).toBe(tab.id); // the same window, not a replacement
    expect(after.route).toBe('/employees/e-1/edit');
    expect(after.entityKey).toBe('employee:e-1');
    expect(after.title).toBe('Ana Reyes');
    expect(after.type).toBe(TabType.RECORD);
    // It was just saved: nothing is pending, and the header must stop saying otherwise.
    expect(after.isDirty).toBe(false);
    expect(tabs.activeTabId()).toBe(tab.id);
  });

  it('leaves the record findable by its own key, so opening it from the list focuses this window', () => {
    const tab = draft();
    tabs.replaceRoute(tab.id, '/employees/e-1/edit');

    tabs.openTab({ route: '/employees/e-1/edit' });

    expect(tabs.tabs().length).toBe(1);
    expect(tabs.activeTabId()).toBe(tab.id);
  });

  it('falls back to the manifest title when the caller has none', () => {
    const tab = draft();
    tabs.replaceRoute(tab.id, '/employees/e-1/edit');
    expect(tabs.tabs()[0].title).toBe('page_titles.employee_edit');
  });

  it('does not leave two windows on one record when that record is already open', () => {
    tabs.openTab({ route: '/employees/e-1/edit' });
    const open = tabs.tabs()[0];

    const tab = draft();
    expect(tabs.tabs().length).toBe(2);

    tabs.replaceRoute(tab.id, '/employees/e-1/edit');

    // The draft window is gone and the one that already held the record is the active one.
    expect(tabs.tabs().length).toBe(1);
    expect(tabs.tabs()[0].id).toBe(open.id);
    expect(tabs.activeTabId()).toBe(open.id);
  });

  it('stops being a preview, so the next record opened from a list cannot overwrite it', () => {
    enablePreview.set(true);
    tabs.openTab({ route: '/employees/e-1/edit' });
    const tab = tabs.tabs()[0];
    expect(tab.isPreview).toBe(true);

    tabs.replaceRoute(tab.id, '/employees/e-2/edit');

    expect(tabs.tabs()[0].isPreview).toBe(false);
    tabs.openTab({ route: '/employees/e-3/edit' });
    expect(tabs.tabs().length).toBe(2);
  });

  it('ignores a window that is no longer open', () => {
    const tab = draft();
    tabs.removeTabSilently(tab.id, false);
    expect(() => tabs.replaceRoute(tab.id, '/employees/e-1/edit')).not.toThrow();
    expect(tabs.tabs().length).toBe(0);
  });
});
