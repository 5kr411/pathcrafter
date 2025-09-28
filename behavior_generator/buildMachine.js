const {
    StateTransition,
    BehaviorIdle,
    NestedStateMachine
} = require('mineflayer-statemachine')

const genMine = require('./mine')
const genCraftInventory = require('./craftInventory')
const genCraftTable = require('./craftTable')

function createStateForStep(bot, step, shared) {
    if (!step || !step.action) return null;
    try {
        if (genMine && typeof genMine.canHandle === 'function' && genMine.canHandle(step)) {
            const s = genMine.create(bot, step)
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
    console.log('PathBuilder: No generator could handle step', step)
    return { isFinished: () => true }
}

function buildStateMachineForPath(bot, pathSteps) {
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
            console.log(`PathBuilder: step ${stepIndex} -> ${step.action}:${step.what}`)
        }}));
        prev = st;
        isFirst = false;
        index++;
    }
    transitions.push(new StateTransition({ parent: prev, child: exit, name: 'final-exit', shouldTransition: () => (prev && typeof prev.isFinished === 'function' ? prev.isFinished() : true), onTransition: () => {
        console.log('PathBuilder: final-exit')
    }}));

    return new NestedStateMachine(transitions, enter, exit);
}

module.exports = { buildStateMachineForPath, _internals: { createStateForStep } };


