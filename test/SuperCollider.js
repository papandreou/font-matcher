const SuperCollider = require('../lib/SuperCollider');
const expect = require('unexpected');

describe('SuperCollider', function() {
  it('should pass a quick litmus test', async function() {
    const superCollider = new SuperCollider([1, 2, 3, 4, 5]);
    expect(superCollider.haveCollision(1, 2), 'to be false');
    superCollider.registerCollision(1, 2);
    expect(superCollider.haveCollision(1, 2), 'to be true');
    expect(superCollider.haveCollision(2, 1), 'to be true');
    superCollider.registerCollision(4, 5);
    superCollider.registerCollision(1, 5);
    expect(superCollider.haveCollision(2, 5), 'to be true');
    expect(superCollider.haveCollision(5, 2), 'to be true');

    expect(superCollider.haveCollision(3, 1), 'to be false');
    expect(superCollider.haveCollision(1, 3), 'to be false');
  });
});
