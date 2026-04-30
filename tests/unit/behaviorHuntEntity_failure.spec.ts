import createHuntEntityState from '../../behaviors/behaviorHuntEntity';

jest.useFakeTimers();

jest.mock('../../behaviors/behaviorPvpAttack', () => ({
  BehaviorPvpAttack: jest.fn().mockImplementation(() => ({
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    isFinished: jest.fn(() => false),
    forceStop: jest.fn()
  }))
}));

jest.mock('../../behaviors/behaviorSafeFollowEntity', () => ({
  BehaviorSafeFollowEntity: jest.fn().mockImplementation(() => ({
    onStateEntered: jest.fn(),
    onStateExited: jest.fn(),
    update: jest.fn(),
    isFinished: jest.fn(() => false),
    followDistance: 0,
    movements: {},
    distanceToTarget: jest.fn(() => 999)
  }))
}));

function makePos(x: number, y: number, z: number) {
  return {
    x,
    y,
    z,
    distanceTo(other: any) {
      const dx = x - other.x;
      const dy = y - other.y;
      const dz = z - other.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  };
}

describe('behaviorHuntEntity - stepSucceeded contract', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.clearAllTimers());

  it('flags failure when no entity found in detection range', () => {
    const bot = {
      entity: { position: makePos(0, 0, 0) },
      entities: {},
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn()
    };

    // No targets.entity provided — the state machine starts in findEntity. The
    // real BehaviorGetClosestEntity has no isFinished method, and findToPvpAttack
    // would otherwise win the transition race, so we exercise the contract on
    // findToExit by invoking its onTransition directly.
    const targets: any = { entityFilter: () => false };
    const sm = createHuntEntityState(bot as any, targets);

    const findToExit = sm.transitions.find(
      (t: any) => t.name === 'BehaviorHuntEntity: find -> exit (no entity found)'
    );
    expect(findToExit).toBeDefined();

    sm.onStateEntered();
    findToExit.onTransition();

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('no_entity_found');
    sm.onStateExited();
  });

  it('flags failure on find timeout', () => {
    const bot = {
      entity: { position: makePos(0, 0, 0) },
      entities: {},
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn()
    };
    const targets: any = { entityFilter: () => false };
    const sm = createHuntEntityState(bot as any, targets);

    const findToExitTimeout = sm.transitions.find(
      (t: any) => t.name === 'BehaviorHuntEntity: find -> exit (timeout)'
    );
    expect(findToExitTimeout).toBeDefined();

    sm.onStateEntered();
    sm.update();    // enter -> findEntity (via enterToFind), starts hunt timeout
    jest.advanceTimersByTime(70_000);  // > HUNT_TIMEOUT (60s) -> huntTimedOut=true
    // Confirm shouldTransition observes the timeout flag, then exercise the
    // contract on the onTransition body directly (findToPvpAttack would
    // otherwise win the transition race in update()).
    expect(findToExitTimeout.shouldTransition()).toBe(true);
    findToExitTimeout.onTransition();

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('find_timeout');
    sm.onStateExited();
  });

  it('flags failure when target is lost during approach', () => {
    const entity = { id: 42, name: 'pig', position: makePos(20, 0, 0) };
    const bot = {
      entity: { position: makePos(0, 0, 0) },
      entities: { 42: entity } as Record<number, any>,
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn()
    };
    const sm = createHuntEntityState(bot as any, { entity, pvpApproachRange: 6 });

    sm.onStateEntered();
    sm.update();           // enter -> approach
    delete bot.entities[42];
    sm.update();           // approach -> exit (target lost)

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('target_lost');
    sm.onStateExited();
  });

  it('flags failure on approach timeout', () => {
    const entity = { id: 7, name: 'pig', position: makePos(40, 0, 0) };
    const bot = {
      entity: { position: makePos(0, 0, 0) },
      entities: { 7: entity },
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn()
    };
    const sm = createHuntEntityState(bot as any, { entity, pvpApproachRange: 6 });

    sm.onStateEntered();
    sm.update();
    jest.advanceTimersByTime(70_000);
    sm.update();

    expect(sm.stepSucceeded).toBe(false);
    expect(sm.stepFailureReason).toBe('approach_timeout');
    sm.onStateExited();
  });
});
