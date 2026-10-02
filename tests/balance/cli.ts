import { LEVELS as REAL_LEVELS } from '@orb/shared';
import { DEMO_LEVELS } from './demoLevels';
import { formatTable, measure, type Summary } from './harness';

declare const process: { argv: string[] };

/** Usage: npm run balance -- [--seeds 20] [--levels 1-10] [--n 1,2,3,4] [--json] [--demo] */
const args = process.argv.slice(2);
// --demo: the purpose-built special-bubble test levels instead of the shipped ones.
const LEVELS = args.includes('--demo') ? DEMO_LEVELS : REAL_LEVELS;
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const seeds = Number(opt('seeds', '20'));
const [from, to] = opt('levels', `1-${LEVELS.length}`).split('-').map(Number);
const counts = opt('n', '1,2,3,4').split(',').map(Number);

const rows: Summary[] = [];
for (let i = Math.max(from, 1); i <= Math.min(to ?? from, LEVELS.length); i++) {
  for (const n of counts) rows.push(measure(LEVELS[i - 1], n, seeds));
}
console.log(args.includes('--json') ? JSON.stringify(rows, null, 2) : formatTable(rows));
