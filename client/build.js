const esbuild = require('esbuild'); const fs = require('fs');
fs.mkdirSync('dist', { recursive: true });
esbuild.buildSync({ entryPoints: ['src/main.jsx'], bundle: true, minify: true, outfile: 'dist/app.js', loader: { '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' } });
fs.copyFileSync('src/styles.css', 'dist/styles.css');
fs.copyFileSync('src/index.html', 'dist/index.html');
console.log('built');
