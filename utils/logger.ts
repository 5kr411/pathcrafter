import * as path from 'path';

// Log levels
type LogLevelType = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SILENT';

export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4
} as const;

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    // Foreground colors
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
} as const;

export class Logger {
    private level: number;
    private useColors: boolean;
    private workspaceRoot: string;

    constructor() {
        // Get log level from environment variable, default to INFO
        const envLevel = process.env.LOG_LEVEL?.toUpperCase();
        this.level = envLevel && envLevel in LogLevel ? LogLevel[envLevel as LogLevelType] : LogLevel.INFO;
        
        // Option to disable colors (useful for file output or CI)
        this.useColors = process.env.LOG_NO_COLOR !== 'true';
        
        // Track the workspace root for relative paths
        this.workspaceRoot = process.cwd();
    }

    /**
     * Set the current log level programmatically
     */
    setLevel(level: string): void {
        const upperLevel = level.toUpperCase();
        if (upperLevel in LogLevel) {
            this.level = LogLevel[upperLevel as LogLevelType];
        }
    }

    /**
     * Get the current log level as a string
     */
    getLevel(): string {
        return Object.keys(LogLevel).find(key => LogLevel[key as LogLevelType] === this.level) || 'INFO';
    }

    /**
     * Get the calling file name from the stack trace
     */
    _getCallerFile(): string {
        const originalPrepareStackTrace = Error.prepareStackTrace;
        try {
            const err = new Error();
            Error.prepareStackTrace = (_, stack) => stack;
            const stack = err.stack as any;
            
            // Find the first stack frame that's not this logger file
            for (let i = 0; i < stack.length; i++) {
                const fileName = stack[i].getFileName();
                if (fileName && !fileName.includes('logger.js') && !fileName.includes('logger.ts')) {
                    // Convert to relative path
                    const relativePath = path.relative(this.workspaceRoot, fileName);
                    // If path goes outside workspace, just use basename
                    if (relativePath.startsWith('..')) {
                        return path.basename(fileName);
                    }
                    return relativePath;
                }
            }
            return 'unknown';
        } catch (e) {
            return 'unknown';
        } finally {
            Error.prepareStackTrace = originalPrepareStackTrace;
        }
    }

    /**
     * Format the timestamp
     */
    _getTimestamp(): string {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${ms}`;
    }

    /**
     * Apply color to text if colors are enabled
     */
    _colorize(text: string, color: string): string {
        if (!this.useColors) return text;
        return `${color}${text}${colors.reset}`;
    }

    /**
     * Core logging method
     */
    _log(level: number, levelName: string, color: string, args: any[]): void {
        if (this.level > level) return; // Skip if below current log level

        const timestamp = this._getTimestamp();
        const callerFile = this._getCallerFile();
        
        const levelTag = this._colorize(`[${levelName}]`, color);
        const timeTag = this._colorize(`[${timestamp}]`, colors.gray);
        const fileTag = this._colorize(`[${callerFile}]`, colors.cyan);
        
        // Construct the prefix
        const prefix = `${timeTag} ${levelTag} ${fileTag}`;
        
        // Log the message
        console.log(prefix, ...args);
    }

    /**
     * Log at DEBUG level
     */
    debug(...args: any[]): void {
        this._log(LogLevel.DEBUG, 'DEBUG', colors.gray, args);
    }

    /**
     * Log at INFO level
     */
    info(...args: any[]): void {
        this._log(LogLevel.INFO, 'INFO ', colors.green, args);
    }

    /**
     * Log at WARN level
     */
    warn(...args: any[]): void {
        this._log(LogLevel.WARN, 'WARN ', colors.yellow, args);
    }

    /**
     * Log at ERROR level
     */
    error(...args: any[]): void {
        this._log(LogLevel.ERROR, 'ERROR', colors.red, args);
    }

    /**
     * Always log regardless of log level (except SILENT)
     */
    always(...args: any[]): void {
        if (this.level === LogLevel.SILENT) return;
        
        const timestamp = this._getTimestamp();
        const callerFile = this._getCallerFile();
        
        const timeTag = this._colorize(`[${timestamp}]`, colors.gray);
        const fileTag = this._colorize(`[${callerFile}]`, colors.cyan);
        
        console.log(`${timeTag} ${fileTag}`, ...args);
    }

    /**
     * Create a child logger with a specific context/prefix
     * Useful for module-specific logging
     */
    child(context: string): Logger {
        const childLogger = Object.create(this) as Logger;
        childLogger._getCallerFile = () => context;
        return childLogger;
    }
}

// Create and export a singleton instance
const logger = new Logger();

export default logger;
