import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcPackageDir = path.join(rootDir, 'src', 'js', 'hic-pageflip');
const distDir = path.join(rootDir, 'dist');

console.log('Building dist package...');

// Clean and recreate dist directory
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// Copy all package source files (index.js, components/, core/) into dist/
fs.cpSync(srcPackageDir, distDir, { recursive: true });

// Copy root metadata files
const rootFiles = ['README.md', 'LICENSE'];
for (const file of rootFiles) {
  const srcPath = path.join(rootDir, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(distDir, file));
  }
}

// Prepare package.json for dist
const pkgPath = path.join(rootDir, 'package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // Strip scripts so consumers don't get internal build/test scripts
  delete pkg.scripts;

  // Replace ./dist/ with ./ so all paths point to the root of the published package
  const distPkgContent = JSON.stringify(pkg, null, 2).replaceAll('./dist/', './') + '\n';

  fs.writeFileSync(
    path.join(distDir, 'package.json'),
    distPkgContent,
    'utf8'
  );
}

console.log('Successfully copied package files to dist/');
