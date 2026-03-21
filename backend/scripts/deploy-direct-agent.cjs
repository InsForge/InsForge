/* eslint-disable */
const fs = require('fs');
const path = require('path');
const http = require('http');

// Locate dependencies in backend/node_modules
const backendDir = path.join(__dirname, '..');
const rootDir = path.join(backendDir, '..');

function resolveModulePath(moduleName) {
  const backendPath = path.join(backendDir, 'node_modules', moduleName);
  const rootPath = path.join(rootDir, 'node_modules', moduleName);
  if (fs.existsSync(backendPath)) return backendPath;
  if (fs.existsSync(rootPath)) return rootPath;
  return null;
}

const admZipPath = resolveModulePath('adm-zip');
const jwtPath = resolveModulePath('jsonwebtoken');

if (!admZipPath || !jwtPath) {
  console.error('Error: Please run `npm install` inside the workspace root first.');
  process.exit(1);
}

const AdmZip = require(admZipPath);
const jwt = require(jwtPath);

// Configuration from .env
const envPath = path.join(backendDir, '.env');
let jwtSecret = process.env.JWT_SECRET || '';
let backendPort = 7130;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const secretMatch = envContent.match(/JWT_SECRET=(.*)/);
  if (secretMatch && secretMatch[1]) jwtSecret = secretMatch[1].trim();
  const portMatch = envContent.match(/PORT=(\d+)/);
  if (portMatch && portMatch[1]) backendPort = parseInt(portMatch[1].trim(), 10);
}

if (!jwtSecret) {
  console.error('Error: JWT_SECRET is required (set backend/.env or process env).');
  process.exit(1);
}

const args = process.argv.slice(2);
const sourceDir = args[0];

if (!sourceDir) {
  console.error(
    'Usage: node deploy-direct-agent.cjs <source_directory_path> [envVars_json_string]'
  );
  console.error('Example: node deploy-direct-agent.cjs ../frontend');
  process.exit(1);
}

const absoluteSource = path.resolve(sourceDir);
if (!fs.existsSync(absoluteSource)) {
  console.error(`Error: Source directory not found: ${absoluteSource}`);
  process.exit(1);
}

// 1. Generate Admin JWT Token
const token = jwt.sign(
  { sub: 'admin', email: 'admin@insforge.local', role: 'project_admin' },
  jwtSecret,
  { expiresIn: '10m' }
);

// 2. Create ZIP
console.log(`Zipping source directory: ${absoluteSource}...`);
const zip = new AdmZip();
zip.addLocalFolder(absoluteSource);
const buffer = zip.toBuffer();
console.log(`Zip created. Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

// 3. Prepare Payload
const envVars = args[1] ? JSON.parse(args[1]) : [];
const boundary = '----InsForgeAgentBoundary' + Math.random().toString(16).substring(2);

let bodyParts = [];

if (envVars.length > 0) {
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="envVars"\r\n\r\n${JSON.stringify(envVars)}\r\n`
    )
  );
}

bodyParts.push(
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="source.zip"\r\nContent-Type: application/zip\r\n\r\n`
  )
);
bodyParts.push(buffer);
bodyParts.push(Buffer.from(`\r\n--${boundary}--`));

const fullBody = Buffer.concat(bodyParts);

// 4. Send Request
const options = {
  hostname: 'localhost',
  port: backendPort,
  path: '/api/deployments/new/start-direct',
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': fullBody.length,
  },
};

console.log(`Uploading to http://localhost:${backendPort}${options.path}...`);

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    try {
      const result = JSON.parse(responseData);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('\n✅ Deployment started successfully!');
        console.log('-----------------------------------');
        console.log(`ID:     ${result.data.id}`);
        console.log(`Status: ${result.data.status}`);
        console.log(`URL:    ${result.data.url || 'Updating...'}`);
        console.log('-----------------------------------');
      } else {
        console.error(`\n❌ Error starting deployment (${res.statusCode}):`);
        console.error(JSON.stringify(result, null, 2));
      }
    } catch (e) {
      console.error(`\n❌ Error parsing response (${res.statusCode}):`, responseData);
    }
  });
});

req.setTimeout(30000, () => {
  req.destroy(new Error('Request timed out after 30 seconds'));
});

req.on('error', (e) => {
  console.error(`\n❌ Network error: ${e.message}`);
});

req.write(fullBody);
req.end();
