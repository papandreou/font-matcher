const SuperCollider = require('./SuperCollider');
const getWordPositions = require('./getWordPositions');
const _ = require('lodash');

async function findDistinctTraceGroupSets(traceGroups, page) {
  const superCollider = new SuperCollider(traceGroups);

  // Find out which trace groups affect the positioning of others
  for (const traceGroup of traceGroups) {
    const style = {
      fontSize: `${4 * parseInt(traceGroup.computedStyle.fontSize)}px`,
      lineHeight: `${4 * parseInt(traceGroup.computedStyle.lineHeight)}px`
    };

    const oldStyles = await page.evaluate(
      (style, ...elements) => {
        const oldStyles = [];
        for (const element of elements) {
          const oldStyle = {};
          for (const prop of Object.keys(style)) {
            oldStyle[prop] = element.style[prop];
          }
          oldStyles.push(oldStyle);
          Object.assign(element.style, style);
        }
        return oldStyles;
      },
      style,
      ...traceGroup.elementHandles
    );

    for (const otherTraceGroup of traceGroups) {
      if (!superCollider.haveCollision(traceGroup, otherTraceGroup)) {
        const wordPositionsNow = await Promise.all(
          otherTraceGroup.elementHandles.map(elementHandle =>
            getWordPositions(page, elementHandle)
          )
        );

        if (
          !_.isEqual(otherTraceGroup.referenceWordPositions, wordPositionsNow)
        ) {
          superCollider.registerCollision(traceGroup, otherTraceGroup);
        }
      }
    }
    await page.evaluate(
      (oldStyles, ...elements) => {
        for (const [i, element] of elements.entries()) {
          Object.assign(element.style, oldStyles[i]);
        }
      },
      oldStyles,
      ...traceGroup.elementHandles
    );
  }
  return superCollider.getCollisionSets();
}

module.exports = findDistinctTraceGroupSets;
