module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    moduleDirectories: ['node_modules', '<rootDir>'],
    verbose: true,
    testTimeout: 30000,
    forceExit: true,
    detectOpenHandles: true,
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};


