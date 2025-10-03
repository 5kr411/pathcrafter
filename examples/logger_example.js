/**
 * Logger Usage Example
 * 
 * This file demonstrates how to use the unified logging system.
 * Run with different log levels to see the difference:
 * 
 *   LOG_LEVEL=DEBUG node examples/logger_example.js
 *   LOG_LEVEL=INFO node examples/logger_example.js
 *   LOG_LEVEL=WARN node examples/logger_example.js
 *   LOG_LEVEL=ERROR node examples/logger_example.js
 *   LOG_LEVEL=SILENT node examples/logger_example.js
 */

const logger = require('../utils/logger');

console.log('===== Logger Example =====\n');
console.log(`Current log level: ${logger.getLevel()}\n`);

// Different log levels
logger.debug('This is a DEBUG message - for detailed debugging information');
logger.info('This is an INFO message - for general informational messages');
logger.warn('This is a WARN message - for warnings that might need attention');
logger.error('This is an ERROR message - for error conditions');

console.log('\n');

// Logging with multiple arguments
logger.info('User logged in:', { username: 'bot_player', timestamp: Date.now() });
logger.debug('Block found at position:', { x: 100, y: 64, z: 200 });

console.log('\n');

// Always log (unless SILENT)
logger.always('This message will always appear (unless LOG_LEVEL=SILENT)');

console.log('\n');

// Creating a child logger with specific context
const moduleLogger = logger.child('ExampleModule');
moduleLogger.info('This uses a child logger with custom context');
moduleLogger.debug('Child logger debug message');

console.log('\n');

// Programmatically changing log level
console.log('Changing log level to ERROR...');
logger.setLevel('ERROR');
console.log(`New log level: ${logger.getLevel()}\n`);

logger.debug('This DEBUG message will not appear');
logger.info('This INFO message will not appear');
logger.warn('This WARN message will not appear');
logger.error('This ERROR message will appear');

console.log('\n===== End of Example =====');

