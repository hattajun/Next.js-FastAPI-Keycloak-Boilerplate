/**
 * Next.js 14.1.x workaround: --inspect=host:port incorrectly parsed
 *
 * Bug: next/dist/server/lib/utils.js does `parseInt("0.0.0.0:9229")` = 0,
 * then spawns workers with `--inspect-brk=...:1` (invalid port → exits).
 *
 * Fix: strip the host from the inspect flag in execArgv before Next.js reads it,
 * while the main process still binds to 0.0.0.0 (set at node startup).
 */
process.execArgv = process.execArgv.map((arg) => {
  const m = arg.match(/^(--inspect(?:-brk)?)=([^:]+):(\d+)$/);
  return m ? `${m[1]}=${m[3]}` : arg;
});

require('./node_modules/next/dist/bin/next');
