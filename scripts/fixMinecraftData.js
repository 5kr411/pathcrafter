const https = require('https');
const fs = require('fs');
const path = require('path');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

async function ensureFile(filePath, contentProvider) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    const content = await contentProvider();
    fs.writeFileSync(filePath, content);
  }
}

async function main() {
  const modRoot = path.join(__dirname, '..', 'node_modules', 'minecraft-data');
  if (!fs.existsSync(modRoot)) return;
  const pkg = JSON.parse(fs.readFileSync(path.join(modRoot, 'package.json'), 'utf8'));
  const tag = `v${pkg.version}`; // repo tags are vX.Y.Z
  const baseRaw = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/${tag}/data`;

  const targets = [
    ['pc/common/features.json', `${baseRaw}/pc/common/features.json`],
    ['bedrock/common/features.json', `${baseRaw}/bedrock/common/features.json`],
    ['pc/common/protocolVersions.json', `${baseRaw}/pc/common/protocolVersions.json`],
    ['bedrock/common/protocolVersions.json', `${baseRaw}/bedrock/common/protocolVersions.json`],
    ['pc/common/versions.json', `${baseRaw}/pc/common/versions.json`],
    ['bedrock/common/versions.json', `${baseRaw}/bedrock/common/versions.json`],
    ['pc/common/legacy.json', `${baseRaw}/pc/common/legacy.json`],
    ['bedrock/common/legacy.json', `${baseRaw}/bedrock/common/legacy.json`]
  ];

  for (const [rel, url] of targets) {
    const outPath = path.join(modRoot, 'minecraft-data', 'data', rel);
    try {
      await ensureFile(outPath, () => fetch(url));
    } catch (e) {
      // If fetching tag failed (e.g., tag naming mismatch), try master as last resort
      try {
        const fallbackUrl = url.replace(`/${tag}/`, '/master/');
        await ensureFile(outPath, () => fetch(fallbackUrl));
      } catch (_) {
        // leave file possibly missing; library may still work depending on code paths
      }
    }
  }
}

main().catch(() => {});



