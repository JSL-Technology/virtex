import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AiProvenanceBadgeComponent } from './ai-provenance-badge.component';

describe('AiProvenanceBadgeComponent', () => {
  function render(id: string | null) {
    TestBed.configureTestingModule({
      imports: [AiProvenanceBadgeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(AiProvenanceBadgeComponent);
    fixture.componentRef.setInput('entityType', 'vendor_bill');
    fixture.componentRef.setInput('entityId', id);
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  it('says where an AI-made record came from, and how many fields a person corrected', () => {
    const { fixture, http } = render('b-1');
    http.expectOne((request) => request.url.endsWith('/ai/provenance/vendor_bill/b-1')).flush([
      { source: 'AI_CAPTURE', fields: { accepted: ['ncf', 'total'], edited: ['date'] }, createdAt: '2026-10-01', agentRunId: null },
    ]);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('ai.provenance.source.ai_capture');
    expect(text).toContain('ai.provenance.edited');
    expect(fixture.nativeElement.querySelector('.aip').getAttribute('title')).toContain('date');
  });

  it('shows nothing for a record a person entered, or when it cannot tell', () => {
    const { fixture, http } = render('b-2');
    http.expectOne(() => true).flush('no', { status: 500, statusText: 'x' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('vx-badge')).toBeNull();
  });

  it('asks nothing for a record not saved yet', () => {
    const { http } = render(null);
    http.expectNone(() => true);
  });
});
