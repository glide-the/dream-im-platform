// [Input] Node standard-output/error streams before the Next.js CLI or worker loads.
// [Output] Immediate, silent failure when logging loses its terminal or pipe.
// [Pos] Runtime preload shared by the normal Next.js development and start commands.
// [Sync] 2026-10-05: stop revoked-TTY write errors before Next.js can recursively log them.

const writeFailureCodes = new Set(['EIO', 'EPIPE', 'EBADF']);
const exitWithoutLogging = () => process.exit(1);

process.stdout.prependListener('error', exitWithoutLogging);
process.stderr.prependListener('error', exitWithoutLogging);

// Next.js can replace uncaughtException listeners. A monitor runs before those
// listeners and only intercepts a failed console write, never an application error.
process.on('uncaughtExceptionMonitor', (error) => {
  if (
    error !== null && typeof error === 'object' &&
    writeFailureCodes.has(error.code) &&
    error.syscall === 'write' &&
    typeof error.stack === 'string' &&
    error.stack.includes('node:internal/console/constructor:')
  ) {
    exitWithoutLogging();
  }
});
