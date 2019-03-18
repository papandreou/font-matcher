class SuperCollider {
  constructor(elements) {
    this.collisions = new Map(
      elements.map(element => [element, new Set([element])])
    );
  }

  haveCollision(a, b) {
    return this.collisions.get(a).has(b);
  }

  registerCollision(a, b) {
    const aSet = this.collisions.get(a);
    const bSet = this.collisions.get(b);
    if (aSet !== bSet) {
      for (const bElement of bSet) {
        aSet.add(bElement);
        this.collisions.set(bElement, aSet);
      }
    }
  }

  getCollisionSets() {
    return [...this.collisions.values()];
  }
}

module.exports = SuperCollider;
