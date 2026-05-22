import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-live-preview',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './live-preview.html',
  styleUrls: ['./live-preview.scss']
})
export class LivePreview { }