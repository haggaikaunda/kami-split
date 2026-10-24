import { writeFileSync } from 'node:fs';
import { inventory } from './inventory.mjs';

export default class InventoryReporter {
  onBegin(config, suite) {
    writeFileSync(
      process.env.BROWSER_INVENTORY_FILE,
      JSON.stringify(inventory(suite.allTests(), config.rootDir)),
    );
  }
}
