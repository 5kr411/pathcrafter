import { Lifecycle } from '../../bots/collector_runner/lifecycle';

const flushImmediates = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('Lifecycle', () => {
  it('finish() invokes onFinish exactly once with the given reason', () => {
    const onFinish = jest.fn();
    const lc = new Lifecycle(onFinish);
    lc.finish('manual');
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith('manual');
  });

  it('second finish() is a no-op', () => {
    const onFinish = jest.fn();
    const lc = new Lifecycle(onFinish);
    lc.finish('first');
    lc.finish('second');
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('coalesces two scheduleFinish calls in the same tick to a single fire', async () => {
    const onFinish = jest.fn();
    const lc = new Lifecycle(onFinish);
    lc.scheduleFinish('a');
    lc.scheduleFinish('b');
    expect(onFinish).not.toHaveBeenCalled();
    await flushImmediates();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith('a');
  });

  it('direct finish() after scheduleFinish() fires once with the direct reason and clears the pending immediate', async () => {
    const onFinish = jest.fn();
    const lc = new Lifecycle(onFinish);
    lc.scheduleFinish('scheduled');
    lc.finish('direct');
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith('direct');
    await flushImmediates();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('scheduleFinish() after finish() does not fire again', async () => {
    const onFinish = jest.fn();
    const lc = new Lifecycle(onFinish);
    lc.finish('first');
    lc.scheduleFinish('later');
    await flushImmediates();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('isFinished() reflects state', async () => {
    const lc = new Lifecycle(() => {});
    expect(lc.isFinished()).toBe(false);
    lc.scheduleFinish('s');
    expect(lc.isFinished()).toBe(false);
    await flushImmediates();
    expect(lc.isFinished()).toBe(true);
  });
});
