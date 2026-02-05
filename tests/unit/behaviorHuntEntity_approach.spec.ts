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

const BehaviorPvpAttack = require('../../behaviors/behaviorPvpAttack').BehaviorPvpAttack as jest.Mock;
const BehaviorSafeFollowEntity = require('../../behaviors/behaviorSafeFollowEntity').BehaviorSafeFollowEntity as jest.Mock;

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

describe('behaviorHuntEntity approach -> pvp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('transitions to pvp when within approach range even if approach is not finished', () => {
    const entity = { id: 1, name: 'pig', position: makePos(1, 0, 0) };
    const bot = {
      entity: { position: makePos(0, 0, 0) },
      entities: { 1: entity },
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn()
    };

    const stateMachine = createHuntEntityState(bot as any, {
      entity,
      pvpApproachRange: 16
    });

    stateMachine.onStateEntered();
    stateMachine.update();
    stateMachine.update();

    const pvpInstance = BehaviorPvpAttack.mock.results[0]?.value;
    expect(BehaviorSafeFollowEntity).toHaveBeenCalled();
    expect(pvpInstance?.onStateEntered).toHaveBeenCalled();
    stateMachine.onStateExited();
  });

  it('waits until within range before transitioning to pvp', () => {
    const entity = { id: 2, name: 'pig', position: makePos(30, 0, 0) };
    const bot = {
      entity: { position: makePos(0, 0, 0) },
      entities: { 2: entity },
      on: jest.fn(),
      off: jest.fn(),
      removeListener: jest.fn()
    };

    const stateMachine = createHuntEntityState(bot as any, {
      entity,
      pvpApproachRange: 16
    });

    stateMachine.onStateEntered();
    stateMachine.update();
    stateMachine.update();

    const pvpInstance = BehaviorPvpAttack.mock.results[0]?.value;
    expect(pvpInstance?.onStateEntered).not.toHaveBeenCalled();

    // Move target into range
    entity.position = makePos(5, 0, 0);
    stateMachine.update();

    expect(pvpInstance?.onStateEntered).toHaveBeenCalled();
    stateMachine.onStateExited();
  });
});
