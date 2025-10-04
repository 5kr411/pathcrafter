// Main entry point - exports from compiled TypeScript
const plannerModule = require('./dist/planner');
module.exports = plannerModule.plan;
module.exports.plan = plannerModule.plan;
module.exports._internals = plannerModule._internals;
module.exports.default = plannerModule.plan;
