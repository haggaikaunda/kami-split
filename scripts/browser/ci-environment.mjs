import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// The official image writes this metadata when baking its browser binaries.
// Check exact versions before launch, including patch releases, rather than
// allowing a dependency update to silently reuse an older browser environment.
export function verifyEnvironment({
  declaredVersion,
  installedVersion,
  image,
  nodeVersion,
  nodeMajor,
  browsersPath,
}) {
  assert.match(
    declaredVersion,
    /^\d+\.\d+\.\d+$/,
    'Pin @playwright/test exactly',
  );
  assert.equal(
    installedVersion,
    declaredVersion,
    'Installed Playwright mismatch',
  );
  assert.equal(
    image.driverVersion,
    declaredVersion,
    'Playwright image mismatch',
  );
  assert.equal(
    image.dockerImageName,
    `mcr.microsoft.com/playwright:v${declaredVersion}-noble`,
    'Use the matching official Noble image',
  );
  assert.equal(nodeVersion.split('.')[0], nodeMajor, 'Node major mismatch');
  assert.equal(
    browsersPath,
    '/ms-playwright',
    'Use the prebuilt browser binaries',
  );
}

async function main() {
  const require = createRequire(import.meta.url);
  const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
  verifyEnvironment({
    declaredVersion: json(new URL('../../package.json', import.meta.url))
      .devDependencies['@playwright/test'],
    installedVersion: require('@playwright/test/package.json').version,
    image: json('/ms-playwright/.docker-info'),
    nodeVersion: process.versions.node,
    nodeMajor: readFileSync(
      new URL('../../.nvmrc', import.meta.url),
      'utf8',
    ).trim(),
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
  });
  // A real launch also rejects absent browser binaries or missing OS libraries.
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  await browser.close();
  console.log('Pinned prebuilt Chromium environment verified');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
