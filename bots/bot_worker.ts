import { workerData } from 'worker_threads';

const mineflayer = require('mineflayer');
const {
  globalSettings,
  StateTransition,
  BotStateMachine,
  BehaviorIdle,
  BehaviorFollowEntity,
  BehaviorLookAtEntity,
  BehaviorGetClosestEntity,
  NestedStateMachine
} = require('mineflayer-statemachine');

globalSettings.debugMode = false;

const bot = mineflayer.createBot({
  host: workerData.host,
  port: workerData.port,
  username: workerData.username,
  password: workerData.password
});

bot.loadPlugin(require('mineflayer-pathfinder').pathfinder);
bot.loadPlugin(require('mineflayer-tool').plugin);

bot.once('spawn', () => {
  const targets: any = {};

  const idleState = new BehaviorIdle();
  const lookAtPlayersState = new BehaviorLookAtEntity(bot, targets);
  const followPlayer = new BehaviorFollowEntity(bot, targets);
  followPlayer.movements.allowFreeMotion = true;
  bot.pathfinder.searchRadius = 32;

  const getClosestPlayer = new BehaviorGetClosestEntity(bot, targets, (entity: any) => {
    if (entity.username === 'astolfo') {
      return true;
    } else {
      return false;
    }
  });

  const lookAtFollowTarget = new BehaviorLookAtEntity(bot, targets);
  const followDistance = Math.random() * (7 - 3) + 3;

  const transitions = [
    new StateTransition({
      // 0
      parent: idleState,
      child: getClosestPlayer,
      name: 'player says "hi"',
      onTransition: () => bot.chat('hello')
    }),

    new StateTransition({
      // 1
      parent: getClosestPlayer,
      child: lookAtPlayersState,
      shouldTransition: () => true
    }),

    new StateTransition({
      // 2
      parent: lookAtPlayersState,
      child: idleState,
      name: 'player says "bye"',
      onTransition: () => bot.chat('goodbye')
    }),

    new StateTransition({
      // 3
      parent: lookAtPlayersState,
      child: followPlayer,
      name: 'player says "come"',
      onTransition: () => bot.chat('coming')
    }),

    new StateTransition({
      // 4
      parent: followPlayer,
      child: lookAtPlayersState,
      name: 'player says "stay"',
      onTransition: () => bot.chat('staying')
    }),

    new StateTransition({
      //  5
      parent: followPlayer,
      child: idleState,
      name: 'player says "bye"',
      onTransition: () => bot.chat('goodbye')
    }),

    new StateTransition({
      // 6
      parent: followPlayer,
      child: lookAtFollowTarget,
      name: 'closeToTarget',
      shouldTransition: () => followPlayer.distanceToTarget() < followDistance
    }),

    new StateTransition({
      // 7
      parent: lookAtFollowTarget,
      child: followPlayer,
      name: 'farFromTarget',
      shouldTransition: () => lookAtFollowTarget.distanceToTarget() >= followDistance
    }),

    new StateTransition({
      // 8
      parent: lookAtFollowTarget,
      child: idleState,
      name: 'player says "bye"',
      onTransition: () => bot.chat('goodbye')
    }),

    new StateTransition({
      // 9
      parent: lookAtFollowTarget,
      child: lookAtPlayersState,
      name: 'player says "stay"'
    })
  ];

  const root = new NestedStateMachine(transitions, idleState);
  root.name = 'main';

  bot.on('chat', (_username: string, message: string) => {
    if (message === 'hi') {
      transitions[0].trigger();
    }

    if (message === 'bye') {
      transitions[2].trigger();
      transitions[5].trigger();
      transitions[8].trigger();
    }

    if (message === 'come') {
      transitions[3].trigger();
    }

    if (message === 'stay') {
      transitions[4].trigger();
      transitions[9].trigger();
    }
  });

  new BotStateMachine(bot, root);
});


export {};
