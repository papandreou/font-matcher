#!/usr/bin/env node

const urlTools = require('urltools');
const puppeteer = require('puppeteer');
const pathModule = require('path');
const writeFile = require('util').promisify(require('fs').writeFile);
const _ = require('lodash');
const simulatedAnnealing = require('./lib/simulatedAnnealing');
const getWordPositions = require('./lib/getWordPositions');
const findClosestWebSafeFont = require('./lib/findClosestWebSafeFont');
const shorthandify = require('./lib/shorthandify');
const findDistinctTraceGroupSets = require('./lib/findDistinctTraceGroupSets');
const fontFamilyParser = require('font-family-papandreou');
const { pickone, integer } = require('chance-generators');

const fontRelatedProps = [
  'font-family',
  'font-style',
  'font-weight',
  'font-size',
  'word-spacing',
  'letter-spacing',
  'line-height'
];

async function transferResults(jsHandle) {
  const results = await jsHandle.jsonValue();
  for (const [i, result] of results.entries()) {
    const resultHandle = await jsHandle.getProperty(String(i));
    const elementHandle = await resultHandle.getProperty('node');
    result.node = elementHandle;
  }
  return results;
}
// linear temperature decreasing
function getTemp(prevTemperature) {
  return prevTemperature - 0.03;
}

const incrementByProp = {
  fontSize: 1,
  lineHeight: 1,
  fontWeight: 100,
  letterSpacing: 0.05,
  wordSpacing: 0.05
};

const pxProps = new Set([
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'wordSpacing'
]);

function stringifyProp(prop, value, boundsByProp) {
  const numericalValue = boundsByProp[prop][0] + incrementByProp[prop] * value;
  const unit = pxProps.has(prop) ? 'px' : '';
  let numStr;
  if (prop === 'fontWeight') {
    return String(numericalValue);
  } else {
    numStr = numericalValue
      .toFixed(4)
      .replace(/(\.(?:[0-9]*[1-9])?)0+$/, '$1')
      .replace(/\.$/, '');
  }
  return `${numStr}${unit}`;
}

function stateToStyle(
  state,
  { boundsByProp, computedStyle, fallbackFontFamily }
) {
  const style = {
    fontFamily: fallbackFontFamily,
    fontStyle: computedStyle.fontStyle
  };
  for (const prop of Object.keys(incrementByProp)) {
    style[prop] = stringifyProp(prop, state[prop], boundsByProp);
  }
  return style;
}

function distance(a, b) {
  return (
    Math.sqrt((a.left - b.left) ** 2 + (a.top - b.top) ** 2) +
    Math.sqrt((a.right - b.right) ** 2 + (a.bottom - b.bottom) ** 2)
  );
}

async function optimize(page, traceGroups) {
  const referenceScreenshot = await page.screenshot();
  const pickPropertyToMutate = pickone(Object.keys(incrementByProp));
  await page.evaluate(imageUrl => {
    document.documentElement.style.backgroundImage = imageUrl;
  }, `url(data:image/png;base64,${referenceScreenshot.toString('base64')})`);

  const pickTraceGroupNumber = integer({ min: 0, max: traceGroups.length - 1 });
  const pickSign = pickone([-1, 1]);

  for (const traceGroup of traceGroups) {
    const fontSize = parseFloat(traceGroup.computedStyle.fontSize);
    let lineHeight = traceGroup.computedStyle.lineHeight;
    if (lineHeight === 'normal') {
      lineHeight = Math.round(1.2 * fontSize);
    } else {
      lineHeight = parseFloat(lineHeight);
    }

    let letterSpacing = traceGroup.computedStyle.letterSpacing;
    if (letterSpacing === 'normal') {
      letterSpacing = 0;
    } else {
      letterSpacing = parseFloat(letterSpacing);
    }
    let wordSpacing = traceGroup.computedStyle.wordSpacing;
    if (wordSpacing === 'normal') {
      wordSpacing = 0;
    } else {
      wordSpacing = parseFloat(wordSpacing);
    }

    traceGroup.boundsByProp = {
      fontSize: [Math.round(fontSize / 2), Math.round(fontSize * 2)],
      lineHeight: [Math.round(lineHeight / 2), Math.round(lineHeight * 2)],
      fontWeight: [100, 900],
      letterSpacing: [letterSpacing - 3, letterSpacing + 3],
      wordSpacing: [wordSpacing - 3, wordSpacing + 3]
    };

    traceGroup.numStepsByProp = {};
    for (const [prop, [min, max]] of Object.entries(traceGroup.boundsByProp)) {
      traceGroup.numStepsByProp[prop] = (max - min) / incrementByProp[prop] + 1;
    }
  }
  const initialState = traceGroups.map(traceGroup => {
    const initialStateForGroup = {};
    for (const [prop, numSteps] of Object.entries(traceGroup.numStepsByProp)) {
      // initialState[prop] = Math.round(Math.random() * numSteps);
      initialStateForGroup[prop] = numSteps >> 1;
    }
    return initialStateForGroup;
  });

  return simulatedAnnealing({
    initialState,
    tempMax: 15,
    tempMin: 0.001,
    newState(state) {
      const newState = state.map(stateItem => ({ ...stateItem }));
      const traceGroupNumber = pickTraceGroupNumber.first();
      const traceGroup = traceGroups[traceGroupNumber];
      let prop;
      let newValue;
      do {
        prop = pickPropertyToMutate.first();
        newValue = state[traceGroupNumber][prop] + pickSign.first();
      } while (newValue < 0 || newValue > traceGroup.numStepsByProp[prop]);
      newState[traceGroupNumber][prop] = newValue;
      return newState;
    },
    getTemp,
    async getEnergy(state) {
      let energy = 0;
      for (const [i, traceGroup] of traceGroups.entries()) {
        const { elementHandles, referenceWordPositions } = traceGroup;

        const style = stateToStyle(state[i], traceGroup);
        for (const [j, elementHandle] of elementHandles.entries()) {
          await page.evaluate(
            (element, style) => Object.assign(element.style, style),
            elementHandle,
            style
          );
          const wordPositions = await getWordPositions(page, elementHandle);

          for (const [k, wordPosition] of wordPositions.entries()) {
            const originalPosition = referenceWordPositions[j][k];
            energy +=
              originalPosition.width *
              originalPosition.height *
              distance(wordPosition, originalPosition);
          }
        }
      }
      return energy;
    }
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false
  });
  try {
    const page = await browser.newPage();
    const fileName = pathModule.resolve(
      __dirname,
      'testdata',
      'independentGroups',
      'index.html'
    );

    await page.goto(urlTools.fsFilePathToFileUrl(fileName));
    const availableFontFamilies = new Set(
      await page.evaluate(() =>
        Array.from(document.fonts).map(font => font.family)
      )
    );

    await page.addScriptTag({
      url: urlTools.fsFilePathToFileUrl(
        pathModule.resolve(
          __dirname,
          'node_modules',
          'font-tracer',
          'dist',
          'fontTracer.browser.js'
        )
      )
    });
    const jsHandle = await page.evaluateHandle(
      /* global fontTracer */
      /* istanbul ignore next */
      propsToReturn =>
        fontTracer(document, {
          deduplicate: false,
          propsToReturn
        }),
      fontRelatedProps
    );
    const traces = await transferResults(jsHandle);
    const webfontTraces = [];
    for (const trace of traces) {
      const fontFamily = trace.props['font-family'];
      if (fontFamily) {
        const fontFamilies = fontFamilyParser.parse(fontFamily);
        if (fontFamilies && availableFontFamilies.has(fontFamilies[0])) {
          trace.fontFamily = fontFamilies[0];
          if (fontFamilies.length > 1) {
            // Intepret the last entry as an explicit fallback:
            trace.fallbackFontFamily = _.last(fontFamilies);
          } else {
            trace.fallbackFontFamily = await findClosestWebSafeFont(
              trace.fontFamily,
              page
            );
          }

          const computedStyle = await page.evaluate(
            node => ({ ...window.getComputedStyle(node) }),
            trace.node
          );
          trace.computedStyle = _.pick(
            computedStyle,
            fontRelatedProps.map(_.camelCase)
          );
          webfontTraces.push(trace);
        }
      }
    }
    const traceGroups = Object.values(
      _.groupBy(
        webfontTraces,
        trace =>
          `${trace.fallbackFontFamily}\x1e${Object.values(
            trace.computedStyle
          ).join('\x1e')}`
      )
    ).map(traces => ({
      computedStyle: traces[0].computedStyle,
      elementHandles: _.map(traces, 'node'),
      traces,
      // FIXME: This assumes that all the traces have the same fallback font-family,
      // which is not guaranteed to be true:
      fontFamily: traces[0].fontFamily,
      fallbackFontFamily: traces[0].fallbackFontFamily
    }));

    if (traceGroups.length === 0) {
      throw new Error('No webfonts to optimize');
    }

    for (const traceGroup of traceGroups) {
      traceGroup.referenceWordPositions = await Promise.all(
        traceGroup.elementHandles.map(elementHandle =>
          getWordPositions(page, elementHandle)
        )
      );
    }

    const distinctTraceGroupSets = await findDistinctTraceGroupSets(
      traceGroups,
      page
    );

    for (const distinctTraceGroupSet of distinctTraceGroupSets) {
      await optimize(page, [...distinctTraceGroupSet]);
    }
  } finally {
    await browser.close();
  }
})();
