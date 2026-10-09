/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser regression orchestrator. */
// Synthetic production-build coverage; real API persistence is covered separately.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const output = process.env.OUTPUT_DIR || '/tmp/kami-material-browser';
fs.mkdirSync(output, { recursive: true });
const reports = [];
for (const width of [320, 390, 768, 1280, 1440]) {
  for (const theme of ['light', 'dark']) {
    const scale = width === 320 || width === 1280 ? 2 : 1;
    const directory = path.join(output, `${width}-${theme}-${scale}`);
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'navigation-browser.cjs')],
      {
        env: {
          ...process.env,
          WIDTH: String(width),
          SCALE: String(scale),
          THEME: theme,
          MATERIAL_TESTS: '1',
          OUTPUT_DIR: directory,
        },
        encoding: 'utf8',
      },
    );
    fs.writeFileSync(
      path.join(output, `${width}-${theme}.log`),
      result.stdout + result.stderr,
    );
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
      process.exit(result.status || 1);
    }
    reports.push({ width, theme, scale, passed: true });
    console.log(JSON.stringify(reports.at(-1)));
  }
}
fs.writeFileSync(
  path.join(output, 'report.json'),
  JSON.stringify(reports, null, 2),
);
