// [Input] Clean Linux CI checkout, complete locked dependencies and successful pnpm build.
// [Output] Private-config-free complete release archive plus SHA-bound file receipt.
// [Pos] Manual Actions packaging; ECS consumes the existing start:embedded runtime.
// [Sync] 2026-11-08: package source, workspace dependency closure and build outputs together.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function releaseEntries(root, sourceFiles) {
  const names = new Set();
  const excluded = name => name.split('/').some(part => part.startsWith('.env') || part === '.git') || name === '.next/cache' || name.startsWith('.next/cache/');
  function add(name) {
    if (excluded(name) || names.has(name)) return;
    const absolute = path.resolve(root, name), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      if (path.isAbsolute(fs.readlinkSync(absolute))) throw Error('Absolute release symlink is not relocatable');
      const target = fs.realpathSync(absolute);
      if (!target.startsWith(root + path.sep)) throw Error('Release symlink escapes checkout');
      names.add(name);
    } else if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute)) add(path.posix.join(name, entry));
    } else if (stat.isFile()) names.add(name);
    else throw Error('Unsupported release file');
  }
  for (const name of sourceFiles) add(name);
  for (const name of ['.next', 'packages/db/dist', 'node_modules', 'packages/db/node_modules']) add(name);
  return [...names].sort().map(name => {
    const absolute = path.join(root, name);
    return fs.lstatSync(absolute).isSymbolicLink()
      ? {path: name, link: fs.readlinkSync(absolute)}
      : {path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')};
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Linux x64 runner required');
  const root = fs.realpathSync('.'), sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (sha !== process.env.GITHUB_SHA) throw Error('Checkout SHA mismatch');
  execFileSync('git', ['diff', '--exit-code']);
  const source = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
  const files = releaseEntries(root, source);
  const receipt = {version: 1, sourceCommit: sha, runId: process.env.GITHUB_RUN_ID, platform: process.platform, arch: process.arch, nodeVersion: process.version, buildId: fs.readFileSync('.next/BUILD_ID', 'utf8').trim(), files};
  fs.mkdirSync('release-output', {recursive: true});
  fs.writeFileSync('release-output/receipt.json', JSON.stringify(receipt) + '\n');
  const list = 'release-output/files.list';
  fs.writeFileSync(list, [...files.map(file => file.path), 'release-output/receipt.json'].join('\0') + '\0');
  execFileSync('tar', ['--null', '--no-recursion', '-T', list, '-czf', 'release-output/admin-release.tgz']);
  fs.unlinkSync(list);
  const digest = crypto.createHash('sha256').update(fs.readFileSync('release-output/admin-release.tgz')).digest('hex');
  fs.writeFileSync('release-output/archive.sha256', digest + '\n');
  console.log(JSON.stringify({sourceCommit: sha, buildId: receipt.buildId, files: files.length, archiveSha256: digest}));
}
