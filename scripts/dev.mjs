import { spawn } from 'node:child_process';
const run = (entry, args) => spawn(process.execPath, [entry, ...args], { stdio: 'inherit' });
const children = [
  run('node_modules/tsx/dist/cli.mjs', ['watch', 'server/index.ts']),
  run('node_modules/vite/bin/vite.js', ['--strictPort', ...process.argv.slice(2)]),
];
function stop(code) {
  children.forEach((child) => child.kill());
  process.exitCode = code;
}
for (const child of children) child.once('exit', (code) => stop(code ?? 0));
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
