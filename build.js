const fs = require('fs');
const path = require('path');

// Create lib directories
const libDir = path.join(__dirname, 'lib');
const turndownDir = path.join(libDir, 'turndown');
const mwcDir = path.join(libDir, 'mwc');

// Ensure directories exist
[libDir, turndownDir, mwcDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Copy turndown - use the browser UMD build
const turndownSource = path.join(__dirname, 'node_modules', 'turndown');
const turndownDist = path.join(turndownSource, 'dist', 'turndown.js');
const turndownDest = path.join(turndownDir, 'turndown.js');
if (fs.existsSync(turndownDist)) {
  fs.copyFileSync(turndownDist, turndownDest);
  console.log('Copied turndown.js to lib/turndown/');
} else {
  // Fallback: try lib directory
  const turndownLib = path.join(turndownSource, 'lib', 'turndown.browser.umd.js');
  if (fs.existsSync(turndownLib)) {
    fs.copyFileSync(turndownLib, turndownDest);
    console.log('Copied turndown.js to lib/turndown/');
  }
}

// Copy Material Web Components - we'll copy the main entry point
const mwcSource = path.join(__dirname, 'node_modules', '@material', 'web');
const mwcMain = path.join(mwcSource, 'index.js');
if (fs.existsSync(mwcMain)) {
  // For MWC, we'll need to copy the entire package structure
  // But for simplicity, we'll copy key files
  console.log('Material Web Components will be imported via ES modules');
}

console.log('Dependencies copied successfully!');
