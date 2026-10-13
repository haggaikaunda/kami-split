/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in before/after visual preservation verification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function preservation({
  page,
  origin,
  workspace,
  width,
  scale,
  output,
  results,
}) {
  await page.goto(
    origin +
      (workspace === 'household'
        ? '/household?tab=overview'
        : '/trips/T?tab=overview'),
  );
  const header = page.locator('[data-ui~="workspace-header"]');
  await header.waitFor();
  const banner = await header.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      backgroundImage: style.backgroundImage.replace(/http:\/\/[^/]+/g, ''),
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      color: style.color,
    };
  });
  await header.screenshot({
    path: path.join(output, `banner-${workspace}.png`),
  });
  await page.goto(
    origin +
      (workspace === 'household'
        ? '/household/expenses?view=breakdown'
        : '/trips/T?tab=expenses&view=breakdown'),
  );
  if (scale === 2)
    await page.addStyleTag({ content: 'html{font-size:200% !important}' });
  const chart = page.getByRole('region', {
    name: 'Spending by category',
    exact: true,
  });
  await chart.waitFor();
  await page.waitForFunction(() => {
    const chart = document.querySelector('.breakdown-chart');
    const svg = chart?.querySelector('svg');
    return (
      chart &&
      svg &&
      svg.viewBox.baseVal.width ===
        Math.round(chart.getBoundingClientRect().width)
    );
  });
  // Chrome's fixed navigation can occlude an element screenshot after automatic
  // scrolling. Hide only that chrome for the identical before/after chart crop.
  await page.addStyleTag({
    content:
      '[data-ui~="workspace-navigation-brand"],[data-ui~="workspace-navigation-links"]{visibility:hidden}',
  });
  await chart.screenshot({
    path: path.join(output, `category-${workspace}-${width}-${scale}.png`),
  });
  const before = await chart.innerText();
  await chart
    .getByRole('button', { name: /Groceries/ })
    .first()
    .click();
  assert.match(await chart.innerText(), /Groceries/);
  await chart.screenshot({
    path: path.join(
      output,
      `category-selected-${workspace}-${width}-${scale}.png`,
    ),
  });
  await chart.getByLabel('Chart amount').selectOption('share');
  await page.waitForURL((url) => url.searchParams.get('basis') === 'share');
  assert.equal(new URL(page.url()).searchParams.get('basis'), 'share');
  const evidence = {
    workspace,
    width,
    scale,
    banner,
    before,
    share: await chart.innerText(),
  };
  fs.writeFileSync(
    path.join(output, `preservation-${workspace}.json`),
    JSON.stringify(evidence, null, 2),
  );
  results.push({ preservation: true, workspace, width, scale });
};
