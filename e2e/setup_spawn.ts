const mineflayer = require('mineflayer');
import { pickRandomBiome, GOOD_BIOMES } from './biomes';

const SETUP_TIMEOUT_MS = 60_000;
const SETUP_USERNAME = 'spawn_setup_bot';

export interface SetupOptions {
  host?: string;
  port?: number;
  biome?: string;  // optional override — skips random pick
}

export async function setupSpawn(options: SetupOptions = {}): Promise<void> {
  const host = options.host ?? 'localhost';
  const port = options.port ?? 25565;
  const biome = options.biome ?? pickRandomBiome();

  console.log(`Setup bot connecting to ${host}:${port} as ${SETUP_USERNAME}...`);

  const bot = mineflayer.createBot({
    host,
    port,
    username: SETUP_USERNAME
  });

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      bot.quit();
      reject(new Error(`Spawn setup timed out after ${SETUP_TIMEOUT_MS / 1000}s`));
    }, SETUP_TIMEOUT_MS);

    bot.once('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    bot.once('spawn', async () => {
      try {
        // Wait a moment for server to fully register the player
        await sleep(2000);

        // Creative mode — setup bot is throwaway, no reason to leave survival
        bot.chat('/gamemode creative');
        await sleep(500);

        console.log(`Locating biome: minecraft:${biome}...`);
        const coords = await locateBiome(bot, biome);
        const tpY = coords.y ?? 200;
        console.log(`Found ${biome} at ${coords.x}, ${coords.y ?? '~'}, ${coords.z}`);

        console.log(`Teleporting to ${coords.x} ${tpY} ${coords.z}...`);
        bot.chat(`/tp ${SETUP_USERNAME} ${coords.x} ${tpY} ${coords.z}`);

        // Wait for the bot to arrive near target, then let chunks load
        await waitForTeleport(bot, coords.x, coords.z);
        await sleep(2000);

        const pos = bot.entity.position;
        console.log(`Arrived at ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`);

        // Verify biome at current position
        const biomeId = bot.world.getBiome(pos);
        const biomeObj = bot.registry.biomes[biomeId];
        const actualBiome = biomeObj?.name;
        console.log(`Biome: ${actualBiome} (id=${biomeId})`);
        if (actualBiome && !actualBiome.includes(biome)) {
          console.warn(`Warning: expected biome containing "${biome}" but got "${actualBiome}"`);
        }

        // Set world spawn here
        bot.chat('/setworldspawn');
        await sleep(1000);
        console.log('World spawn set.');

        clearTimeout(timeout);
        bot.quit();
        resolve();
      } catch (err) {
        clearTimeout(timeout);
        bot.quit();
        reject(err);
      }
    });
  });
}

async function locateBiome(bot: any, biome: string): Promise<{ x: number; y: number | null; z: number }> {
  // Try each biome in the good biomes list, starting with the requested one
  const biomesToTry = [biome, ...GOOD_BIOMES.filter(b => b !== biome)];

  for (const b of biomesToTry) {
    try {
      const coords = await tryLocateBiome(bot, b);
      return coords;
    } catch (_) {
      console.log(`Biome ${b} not found, trying next...`);
    }
  }
  throw new Error('No suitable biome found with this seed');
}

function tryLocateBiome(bot: any, biome: string): Promise<{ x: number; y: number | null; z: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bot.removeListener('message', onMessage);
      reject(new Error(`Timeout waiting for /locate response for ${biome}`));
    }, 10_000);

    function onMessage(jsonMsg: any): void {
      const text = jsonMsg.toString();
      // Success: "The nearest minecraft:forest is at [X, Y, Z] (N blocks away)"
      // Y may be ~ (older versions) or a number (1.21.11+)
      const match = text.match(/is at \[(-?\d+),\s*(~|-?\d+),\s*(-?\d+)\]/);
      if (match) {
        clearTimeout(timeout);
        bot.removeListener('message', onMessage);
        const y = match[2] === '~' ? null : parseInt(match[2], 10);
        resolve({ x: parseInt(match[1], 10), y, z: parseInt(match[3], 10) });
        return;
      }
      // Failure: "Could not find..."
      if (text.includes('Could not find')) {
        clearTimeout(timeout);
        bot.removeListener('message', onMessage);
        reject(new Error(`Biome ${biome} not found`));
      }
    }

    bot.on('message', onMessage);
    bot.chat(`/locate biome minecraft:${biome}`);
  });
}

function waitForTeleport(bot: any, targetX: number, targetZ: number): Promise<void> {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const dx = Math.abs(bot.entity.position.x - targetX);
      const dz = Math.abs(bot.entity.position.z - targetZ);
      if (dx < 10 && dz < 10) {
        clearInterval(check);
        resolve();
      }
    }, 200);
    // Safety: resolve after 15s even if not at target
    setTimeout(() => {
      clearInterval(check);
      resolve();
    }, 15_000);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Allow running standalone
if (require.main === module) {
  const biomeArg = process.argv.find(a => a.startsWith('--biome='))?.split('=')[1];
  const hostArg = process.argv.find(a => a.startsWith('--host='))?.split('=')[1];
  const portArg = process.argv.find(a => a.startsWith('--port='))?.split('=')[1];

  setupSpawn({
    host: hostArg,
    port: portArg ? parseInt(portArg, 10) : undefined,
    biome: biomeArg
  }).then(() => {
    console.log('Spawn setup complete.');
    process.exit(0);
  }).catch((err) => {
    console.error('Spawn setup failed:', err.message);
    process.exit(1);
  });
}
