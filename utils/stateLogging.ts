import logger from './logger';

interface StateLoggingOptions {
    logEnter?: boolean;
    logExit?: boolean;
    getExtraInfo?: (() => string) | null;
}

interface BehaviorToInstrument {
    behavior: any;
    name: string;
    options?: StateLoggingOptions;
}

interface TransitionLoggerOptions {
    logTime?: boolean;
}

/**
 * Adds logging to a mineflayer-statemachine behavior's lifecycle hooks
 * @param behavior - The behavior state to instrument
 * @param name - A descriptive name for logging
 * @param options - Logging options
 * @returns The instrumented behavior (same object, modified)
 */
export function addStateLogging(behavior: any, name: string, options: StateLoggingOptions = {}): any {
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
        
        behavior.onStateEntered = function(...args: any[]) {
            try {
                const extra = getExtraInfo ? getExtraInfo() : '';
                const msg = extra ? `${name}: entered ${extra}` : `${name}: entered`;
                logger.debug(msg);
            } catch (err: any) {
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
        
        behavior.onStateExited = function(...args: any[]) {
            try {
                const extra = getExtraInfo ? getExtraInfo() : '';
                const msg = extra ? `${name}: exited ${extra}` : `${name}: exited`;
                logger.debug(msg);
            } catch (err: any) {
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
 * @param behaviors - Array of behaviors to instrument
 * @returns The instrumented behaviors
 */
export function addStateLoggingBatch(behaviors: BehaviorToInstrument[]): any[] {
    return behaviors.map(({ behavior, name, options }) => 
        addStateLogging(behavior, name, options)
    );
}

/**
 * Creates a logging wrapper for state transitions with detailed timing
 * @param transitionName - Name of the transition
 * @param originalOnTransition - Original onTransition handler (optional)
 * @param options - Options
 * @returns Enhanced onTransition handler
 */
export function createTransitionLogger(
    transitionName: string, 
    originalOnTransition: (() => any) | null = null, 
    options: TransitionLoggerOptions = {}
): () => any {
    const { logTime = false } = options;
    let startTime: number | null = null;

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

