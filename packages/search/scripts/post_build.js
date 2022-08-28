const fs = require('fs');

const packageJsonPath = './pkg/package.json';
const rawPackage = fs.readFileSync(packageJsonPath);
const parsedPackage = JSON.parse(rawPackage);

// Add the `"type": "module"` to the package.json
// in order to make it fully compatible as an ESM.
parsedPackage.type = 'module';

const serializedPackage = JSON.stringify(parsedPackage, null, 2);

fs.writeFileSync(packageJsonPath, serializedPackage);
