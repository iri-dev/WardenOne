/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
function cleanupProfile(directory, prefix) {
  const target = path.resolve(directory);
  if (!/^wo-[a-z-]+-$/.test(prefix) || path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith(prefix))
    throw Error('Refusing to remove a profile outside its expected temporary directory');
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$profileTarget=[IO.Path]::GetFullPath($env:WARDENONE_TEST_PROFILE); $profileRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\'); " +
      "if ([IO.Path]::GetDirectoryName($profileTarget) -ne $profileRoot -or -not [IO.Path]::GetFileName($profileTarget).StartsWith($env:WARDENONE_TEST_PREFIX)) { throw 'Unexpected cleanup target' }; " +
      "if (Test-Path -LiteralPath $profileTarget) { Remove-Item -LiteralPath $profileTarget -Recurse -Force -ErrorAction Stop }"],
    { env: { ...process.env, WARDENONE_TEST_PROFILE: target, WARDENONE_TEST_PREFIX: prefix }, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error((result.stderr || result.stdout || error.message).trim());
  }
}
module.exports = { cleanupProfile };
