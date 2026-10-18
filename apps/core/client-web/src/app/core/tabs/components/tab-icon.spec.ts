import { File, History, Workflow } from 'lucide-angular';
import { resolveTabIcon } from './tab-icon';

describe('resolveTabIcon', () => {
  it('draws the icon a manifest names, not only the handful the tab bar listed', () => {
    expect(resolveTabIcon('Workflow')).toBe(Workflow);
    expect(resolveTabIcon('History')).toBe(History);
  });

  it('falls back to a page for an unknown or missing name', () => {
    expect(resolveTabIcon('NoSuchIcon')).toBe(File);
    expect(resolveTabIcon(undefined)).toBe(File);
  });
});
