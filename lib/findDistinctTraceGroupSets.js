const SuperCollider = require('./SuperCollider');
const getWordPositions = require('./getWordPositions');
const _ = require('lodash');

async function findDistinctTraceGroupSets(traceGroups, page) {
  const superCollider = new SuperCollider(traceGroups);

  // Find out which trace groups affect the positioning of others
  for (const traceGroup of traceGroups) {
    const fontSize = `${4 * parseInt(traceGroup.computedStyle.fontSize)}px`;
    const lineHeight = `${4 * parseInt(traceGroup.computedStyle.lineHeight)}px`;

    const oldStyles = await page.evaluate(
      (fontSize, lineHeight, ...elements) => {
        const oldStyles = [];
        for (const element of elements) {
          oldStyles.push([element.style.fontSize, element.style.lineHeight]);
          element.style.fontSize = fontSize;
          element.style.lineHeight = lineHeight;
        }
        return oldStyles;
      },
      fontSize,
      lineHeight,
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
          element.style.fontSize = oldStyles[i][0];
          element.style.lineHeight = oldStyles[i][1];
        }
      },
      oldStyles,
      ...traceGroup.elementHandles
    );
  }
  return superCollider.getCollisionSets();
}

module.exports = findDistinctTraceGroupSets;
