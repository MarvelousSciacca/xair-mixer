// macOS: senza certificato Apple l'app viene firmata "ad hoc", altrimenti sui Mac con chip Apple
// il sistema la considera danneggiata. Al primo avvio serve comunque tasto destro → Apri.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
