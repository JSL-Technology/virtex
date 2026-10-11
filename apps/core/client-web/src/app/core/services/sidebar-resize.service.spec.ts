import { TestBed } from '@angular/core/testing';
import { SidebarResizeService } from './sidebar-resize.service';

describe('SidebarResizeService', () => {
  function make(): SidebarResizeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(SidebarResizeService);
  }

  beforeEach(() => localStorage.clear());

  it('follows the responsive CSS defaults until the reader resizes', () => {
    // `null` width = "don't write --panel-width", so the media queries keep deciding.
    const service = make();
    expect(service.width()).toBeNull();
    expect(service.isCustomized()).toBe(false);
    expect(service.widthStyle()).toBeNull();
  });

  it('clamps a chosen width into the usable band and exposes it as a px string', () => {
    const service = make();
    service.setWidth(10_000);
    expect(service.width()).toBe(SidebarResizeService.MAX);
    service.setWidth(10);
    expect(service.width()).toBe(SidebarResizeService.MIN);
    service.setWidth(320);
    expect(service.widthStyle()).toBe('320px');
    expect(service.isCustomized()).toBe(true);
  });

  it('reset returns to the responsive default (null), not a fixed number', () => {
    const service = make();
    service.setWidth(320);
    service.reset();
    expect(service.width()).toBeNull();
    expect(service.widthStyle()).toBeNull();
  });

  it('remembers a chosen width across instances, and forgets it on reset', () => {
    const first = make();
    first.setWidth(300);

    expect(make().width()).toBe(300);

    const third = make();
    third.reset();
    expect(make().width()).toBeNull();
  });
});
