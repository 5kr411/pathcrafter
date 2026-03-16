import { getPlayerCount, stopServer } from './server';

export function teardown(): void {
  const playerCount = getPlayerCount();

  if (playerCount > 0) {
    console.log(`${playerCount} player(s) still connected — leaving server running.`);
    return;
  }

  console.log('No players connected. Stopping server...');
  stopServer();
  console.log('Server stopped and removed.');
}

// Allow running standalone
if (require.main === module) {
  teardown();
}
