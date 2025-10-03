const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const genMine = require('./mine')
const genCraftInventory = require('./craftInventory')
const genCraftTable = require('./craftTable')
const genSmelt = require('./smelt')
const logger = require('../utils/logger')

function createStateForStep(bot, step, shared) {
    if (!step || !step.action) return null;
    try {
        if (genMine && typeof genMine.canHandle === 'function' && genMine.canHandle(step)) {
            const s = genMine.create(bot, step)
            if (s) return s
        }
    } catch (_) {}
    try {
        if (genSmelt && typeof genSmelt.canHandle === 'function' && genSmelt.canHandle(step)) {
            const s = genSmelt.create(bot, step)
            if (s) return s
        }
    } catch (_) {}
    try {
        if (genCraftInventory && typeof genCraftInventory.canHandle === 'function' && genCraftInventory.canHandle(step)) {
            const s = genCraftInventory.create(bot, step)
            if (s) return s
        }
    } catch (_) {}
    try {
        if (genCraftTable && typeof genCraftTable.canHandle === 'function' && genCraftTable.canHandle(step)) {
            const s = genCraftTable.create(bot, step)
            if (s) return s
        }
    } catch (_) {}
    logger.info('PathBuilder: No generator could handle step', step)
    return { isFinished: () => true }
}

function buildStateMachineForPath(bot, pathSteps, onFinished) {
    const enter = new BehaviorIdle();
    const exit = new BehaviorIdle();
    const transitions = [];

    let prev = enter;
    const shared = {};
    let isFirst = true;
    let index = 0;
    for (const step of pathSteps) {
        const st = createStateForStep(bot, step, shared);
        if (!st) continue;
        const parent = prev;
        const should = isFirst ? () => true : () => (parent && typeof parent.isFinished === 'function' ? parent.isFinished() : true);
        const stepIndex = index;
        transitions.push(new StateTransition({ parent, child: st, name: `step:${stepIndex}:${step.action}:${step.what}`, shouldTransition: should, onTransition: () => {
            logger.info(`PathBuilder: step ${stepIndex} -> ${step.action}:${step.what}`)
        }}));
        prev = st;
        isFirst = false;
        index++;
    }
    transitions.push(new StateTransition({ parent: prev, child: exit, name: 'final-exit', shouldTransition: () => (prev && typeof prev.isFinished === 'function' ? prev.isFinished() : true), onTransition: () => {
        logger.info('PathBuilder: final-exit')
        try { if (typeof onFinished === 'function') onFinished(); } catch (_) {}
    }}));

    return new NestedStateMachine(transitions, enter, exit);
}

module.exports = { buildStateMachineForPath, _internals: { createStateForStep } };


