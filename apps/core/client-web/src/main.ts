import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { suppressBenignResizeObserverErrors } from './app/core/errors/suppress-benign-resize-observer';

// Before bootstrap, so the capture-phase listener is in place ahead of Angular's global one.
suppressBenignResizeObserverErrors();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
