import { Component, inject, signal, OnInit } from '@angular/core';
// import { JournalsService } from '@app/core/api/journals.service';
// import { Journal } from '@app/core/models/journal.model';
import { RouterLink } from '@angular/router';
import { JournalsService } from '../../../core/api/journals.service';
import { Journal } from '../../../core/models/journal.model';

@Component({
  selector: 'app-journal-list',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './journal-list.page.html',
  styleUrls: ['./journal-list.page.scss']
})
export class JournalListPage implements OnInit {
  private journalsService = inject(JournalsService);

  journals = signal<Journal[]>([]);

  ngOnInit() {
    this.journalsService.getJournals().subscribe(journals => {
      this.journals.set(journals);
    });
  }
}