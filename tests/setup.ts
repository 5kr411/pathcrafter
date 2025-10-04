/**
 * Jest test setup
 * This file runs before all tests
 */

// Set log level to SILENT for tests to avoid cluttering test output
// Can be overridden by setting LOG_LEVEL environment variable
if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = 'SILENT';
}

import logger from '../utils/logger';
logger.setLevel(process.env.LOG_LEVEL || 'SILENT');

