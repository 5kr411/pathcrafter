const { getSuffixTokenFromName } = require('../utils/items');
const { createEnumeratorContext } = require('../utils/enumeratorFactory');

function enumerateShortestPathsGenerator(tree, options = {}) {
    const ctx = createEnumeratorContext(options, 'composableWithFamilies');

    function makeLeafStream(step) { return function* () { yield { path: [step], length: 1 }; }; }

    const sanitizePath = ctx.sanitizePath;
    const isPathValid = ctx.isPathValid;

    function missingConsumablesScoreForCraft(step) {
        if (!step || step.action !== 'craft') return 0;
        const resultItem = step.result && step.result.item;
        const suffix = getSuffixTokenFromName(resultItem);
        const isTool = suffix && new Set(['pickaxe','axe','shovel','hoe','sword','shears']).has(suffix);
        const ing = Array.isArray(step.ingredients) ? step.ingredients : [];
        let missing = 0;
        for (const i of ing) {
            const need = (i && i.perCraftCount ? i.perCraftCount : 0) * (step.count || 1);
            const have = ctx.initialSupply.get(i && i.item) || 0;
            if (need > have) missing += (need - have);
        }
        const bias = isTool ? 0.01 : 0.001;
        return missing * bias;
    }

    function missingConsumablesBiasForItem(item) {
        if (!item || !item.path || item.path.length === 0) return 0;
        const last = item.path[item.path.length - 1];
        if (!last || last.action !== 'craft') return 0;
        const resultItem = last.result && last.result.item;
        const suffix = getSuffixTokenFromName(resultItem);
        const isTool = suffix && new Set(['pickaxe','axe','shovel','hoe','sword','shears']).has(suffix);
        const ing = Array.isArray(last.ingredients) ? last.ingredients : [];
        let missing = 0;
        for (const i of ing) {
            const need = (i && i.perCraftCount ? i.perCraftCount : 0) * (last.count || 1);
            const have = ctx.initialSupply.get(i && i.item) || 0;
            if (need > have) missing += (need - have);
        }
        const bias = isTool ? 0.01 : 0.001;
        return missing * bias;
    }

    const { createPriorityStreams } = require('../utils/priorityStreams');
    const { makeOrStream, makeAndStream } = createPriorityStreams({
        getItemScore: (item) => item.length + missingConsumablesBiasForItem(item),
        getParentStepScore: (step) => (step ? 1 + (step.action === 'craft' ? missingConsumablesScoreForCraft(step) : 0) : 0),
        sanitizePath,
        isPathValid,
        finalizeItem: (cleaned) => ({ path: cleaned, length: cleaned.length })
    });

    const makeStream = ctx.createMakeStream(makeLeafStream, makeOrStream, makeAndStream);
    const stream = makeStream(tree);
    return (function* () { for (const item of stream()) yield item.path; })();
}

module.exports = { enumerateShortestPathsGenerator };




