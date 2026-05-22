import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewInvoicePage } from './new.page';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Search, Download, FileSpreadsheet, ArrowUp, ArrowDown, ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, Printer, Mail, Copy, FileDown, FileText, ArrowLeft, ArrowRight, Settings, HelpCircle, FileUp, X } from 'lucide-angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('NewInvoicePage', () => {
  let component: NewInvoicePage;
  let fixture: ComponentFixture<NewInvoicePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        NewInvoicePage,
        HttpClientTestingModule,
        RouterTestingModule,
        ReactiveFormsModule,
        NoopAnimationsModule,
        LucideAngularModule.pick({ PlusCircle, Filter, MoreHorizontal, Search, Download, FileSpreadsheet, ArrowUp, ArrowDown, ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, Printer, Mail, Copy, FileDown, FileText, ArrowLeft, ArrowRight, Settings, HelpCircle, FileUp, X })
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewInvoicePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
