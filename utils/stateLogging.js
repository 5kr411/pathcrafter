const logger = require('./logger');

/**
 * Adds logging to a mineflayer-statemachine behavior's lifecycle hooks
 * @param {Object} behavior - The behavior state to instrument
 * @param {string} name - A descriptive name for logging
 * @param {Object} options - Logging options
 * @param {boolean} options.logEnter - Log when state is entered (default: true)
 * @param {boolean} options.logExit - Log when state is exited (default: false)
 * @param {function} options.getExtraInfo - Optional function to get additional info to log
 * @returns {Object} The instrumented behavior (same object, modified)
 */
function addStateLogging(behavior, name, options = {}) {
    if (!behavior || typeof behavior !== 'object') return behavior;
    
    const {
        logEnter = true,
        logExit = false,
        getExtraInfo = null
    } = options;

    // Wrap onStateEntered if logging entry
    if (logEnter) {
        const originalOnStateEntered = typeof behavior.onStateEntered === 'function' 
            ? behavior.onStateEntered.bind(behavior) 
            : null;
        
        behavior.onStateEntered = function(...args) {
            try {
                const extra = getExtraInfo ? getExtraInfo() : '';
                const msg = extra ? `${name}: entered ${extra}` : `${name}: entered`;
                logger.debug(msg);
            } catch (err) {
                logger.debug(`${name}: entered (error getting extra info: ${err.message})`);
            }
            
            if (originalOnStateEntered) {
                return originalOnStateEntered(...args);
            }
        };
    }

    // Wrap onStateExited if logging exit
    if (logExit) {
        const originalOnStateExited = typeof behavior.onStateExited === 'function'
            ? behavior.onStateExited.bind(behavior)
            : null;
        
        behavior.onStateExited = function(...args) {
            try {
                const extra = getExtraInfo ? getExtraInfo() : '';
                const msg = extra ? `${name}: exited ${extra}` : `${name}: exited`;
                logger.debug(msg);
            } catch (err) {
                logger.debug(`${name}: exited (error getting extra info: ${err.message})`);
            }
            
            if (originalOnStateExited) {
                return originalOnStateExited(...args);
            }
        };
    }

    return behavior;
}

/**
 * Adds logging to multiple behaviors at once
 * @param {Array<{behavior: Object, name: string, options?: Object}>} behaviors - Array of behaviors to instrument
 * @returns {Array<Object>} The instrumented behaviors
 */
function addStateLoggingBatch(behaviors) {
    return behaviors.map(({ behavior, name, options }) => 
        addStateLogging(behavior, name, options)
    );
}

/**
 * Creates a logging wrapper for state transitions with detailed timing
 * @param {string} transitionName - Name of the transition
 * @param {function} originalOnTransition - Original onTransition handler (optional)
 * @param {Object} options - Options
 * @param {boolean} options.logTime - Whether to log timing info (default: false)
 * @returns {function} Enhanced onTransition handler
 */
function createTransitionLogger(transitionName, originalOnTransition = null, options = {}) {
    const { logTime = false } = options;
    let startTime = null;

    return function() {
        try {
            if (logTime && !startTime) {
                startTime = Date.now();
            }
            
            const elapsed = logTime && startTime ? ` (${Date.now() - startTime}ms)` : '';
            logger.debug(`Transition: ${transitionName}${elapsed}`);
            
            if (originalOnTransition && typeof originalOnTransition === 'function') {
                return originalOnTransition();
            }
        } catch (err) {
            logger.error(`Transition ${transitionName}: error in handler`, err);
        }
    };
}

module.exports = {
    addStateLogging,
    addStateLoggingBatch,
    createTransitionLogger
};

