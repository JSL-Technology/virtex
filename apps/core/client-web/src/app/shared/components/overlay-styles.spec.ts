import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A component that renders into the CDK overlay cannot style that content from `:host`.
 *
 * The overlay hangs off `<body>`, outside the component's host element, and `:host ::ng-deep .x`
 * compiles to «`.x` inside the host». The dialog's panel, header, body and footer were all written
 * that way, so none of their rules ever matched and every confirmation and step-up rendered as
 * loose elements over the blurred backdrop (QA M-11). jsdom does not apply component stylesheets,
 * so this reads the sources.
 */
const APP = join(__dirname, '..', '..');

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return components(path);
    return entry.name.endsWith('.component.ts') || entry.name.endsWith('.page.ts') ? [path] : [];
  });
}

describe('styles of overlay content', () => {
  const overlayComponents = components(APP).filter((file) =>
    /from '@angular\/cdk\/overlay'/.test(readFileSync(file, 'utf8')),
  );

  it('finds the components that render into the overlay', () => {
    expect(overlayComponents.length).toBeGreaterThan(0);
  });

  it.each(overlayComponents)('%s does not scope overlay styles to its host', (file) => {
    const scss = file.replace(/\.ts$/, '.scss');
    if (!existsSync(scss)) return;
    // Rules only: the stylesheet's own comment explains the mistake by quoting it.
    const rules = readFileSync(scss, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(rules).not.toMatch(/:host\s+::ng-deep/);
  });
});
