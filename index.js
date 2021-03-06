#!/usr/bin/env node

const urlTools = require('urltools');
const puppeteer = require('puppeteer');
const pathModule = require('path');
const _ = require('lodash');
const simulatedAnnealing = require('./lib/simulatedAnnealing');
const getWordPositions = require('./lib/getWordPositions');
const findClosestWebSafeFont = require('./lib/findClosestWebSafeFont');
const shorthandify = require('./lib/shorthandify');
const findDistinctTraceGroupSets = require('./lib/findDistinctTraceGroupSets');
const fontFamilyParser = require('font-family-papandreou');
const { pickone, integer } = require('chance-generators');
const fontSnapper = require('font-snapper');
const cssFontWeightNames = require('css-font-weight-names');

const fontStretchValues = {
  'ultra-condensed': '50%',
  'extra-condensed': '62.5%',
  condensed: '75%',
  'semi-condensed': '87.5%',
  normal: '100%',
  'semi-expanded': '112.5%',
  expanded: '125%',
  'extra-expanded': '150%',
  'ultra-expanded': '200%'
};

const fontRelatedProps = [
  'font-family',
  'font-style',
  'font-weight',
  'font-size',
  'font-stretch',
  'word-spacing',
  'letter-spacing',
  'line-height'
];

async function evaluateLocalScript(page, path) {
  const scriptTag = await page.addScriptTag({
    url: urlTools.fsFilePathToFileUrl(path)
  });

  await page.evaluate(scriptTag => {
    scriptTag.parentNode.removeChild(scriptTag);
  }, scriptTag);
}

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

async function applyStateToPage(traceGroups, state, page) {
  for (const [i, traceGroup] of traceGroups.entries()) {
    const style = stateToStyle(state[i], traceGroup);
    for (const elementHandle of traceGroup.elementHandles) {
      await page.evaluate(
        (element, style) => Object.assign(element.style, style),
        elementHandle,
        style
      );
    }
  }
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

  const [bestState, bestEnergy] = await simulatedAnnealing({
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
      await applyStateToPage(traceGroups, state, page);
      let energy = 0;
      for (const traceGroup of traceGroups) {
        const { elementHandles, referenceWordPositions } = traceGroup;

        for (const [j, elementHandle] of elementHandles.entries()) {
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

  await applyStateToPage(traceGroups, bestState, page);

  return [bestState, bestEnergy];
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

    // With kebab-case property names as font-snapper needs:
    const availableFonts = _.uniqWith(
      await page.evaluate(() =>
        Array.from(document.fonts).map(
          ({ family, style, weight, stretch }) => ({
            'font-family': family,
            'font-style': style,
            'font-weight': weight,
            'font-stretch': stretch
          })
        )
      ),
      _.isEqual
    );

    await evaluateLocalScript(
      page,
      pathModule.resolve(
        __dirname,
        'node_modules',
        'font-tracer',
        'dist',
        'fontTracer.browser.js'
      )
    );

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

          const snapped = fontSnapper(availableFonts, {
            'font-family': computedStyle.fontFamily,
            'font-style': computedStyle.fontStyle,
            'font-weight': computedStyle.fontWeight,
            'font-stretch': computedStyle.fontStretch
          });

          // Pretend that computedStyle contained the snapped values, as that makes the subsequent steps easier:
          Object.assign(computedStyle, {
            fontFamily: snapped['font-family'],
            fontStyle: snapped['font-style'],
            fontWeight:
              cssFontWeightNames[snapped['font-weight']] ||
              snapped['font-weight'],
            fontStretch:
              fontStretchValues[snapped['font-stretch']] ||
              snapped['font-stretch']
          });
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

    await evaluateLocalScript(
      page,
      pathModule.resolve(
        __dirname,
        'node_modules',
        'optimal-select',
        'dist',
        'optimal-select.js'
      )
    );
    for (const traceGroup of traceGroups) {
      traceGroup.referenceWordPositions = await Promise.all(
        traceGroup.elementHandles.map(elementHandle =>
          getWordPositions(page, elementHandle)
        )
      );

      traceGroup.cssSelector = await page.evaluate((...elements) => {
        /* global OptimalSelect */
        const cssSelector = OptimalSelect.getMultiSelector(elements, {
          ignore: {
            attribute(name) {
              return name === 'style';
            }
          }
        });
        // Sanity check the selector:
        const queriedElements = [...document.querySelectorAll(cssSelector)];
        if (
          queriedElements.length !== elements.length ||
          !elements.every(element => queriedElements.includes(element))
        ) {
          throw new Error(
            `OptimalSelect produced a selector that does not uniquely identify the elements of the trace group`
          );
        }

        return cssSelector;
      }, ...traceGroup.elementHandles);
    }

    const distinctTraceGroupSets = await findDistinctTraceGroupSets(
      traceGroups,
      page
    );

    console.log(
      `<script>(${function() {
        const fontStretchValues = {
          'ultra-condensed': '50%',
          'extra-condensed': '62.5%',
          condensed: '75%',
          'semi-condensed': '87.5%',
          normal: '100%',
          'semi-expanded': '112.5%',
          expanded: '125%',
          'extra-expanded': '150%',
          'ultra-expanded': '200%'
        };
        if (document.fonts) {
          document.fonts.forEach(function(fontFace) {
            const id = `${fontFace.family.replace(/ /g, '_')}-${
              fontFace.style
            }-${fontFace.weight}-${(
              fontStretchValues[fontFace.stretch] || fontFace.stretch
            ).replace(/%$/, '')}`;
            const className = `awaiting-${id}`;
            document.documentElement.classList.add(className);
            fontFace.loaded.then(() => {
              document.documentElement.classList.remove(className);
            });
          });
        }
      }.toString()})();</script>`
    );
    console.log('<style>');
    for (const distinctTraceGroupSet of distinctTraceGroupSets) {
      const [bestState, bestEnergy] = await optimize(page, [
        ...distinctTraceGroupSet
      ]);

      for (const [i, traceGroup] of [...distinctTraceGroupSet].entries()) {
        const style = stateToStyle(bestState[i], traceGroup);
        style.fontFamily = `${traceGroup.fontFamily}, ${style.fontFamily}`;
        const cssProps = Object.entries(style)
          .map(([key, value]) => `  ${_.kebabCase(key)}: ${value};`)
          .join('\n');
        const id = `${traceGroup.fontFamily.replace(/ /g, '_')}-${
          traceGroup.computedStyle.fontStyle
        }-${
          traceGroup.computedStyle.fontWeight
        }-${traceGroup.computedStyle.fontStretch.replace(/%$/, '')}`;
        console.log(
          `.awaiting-${id} ${
            traceGroup.cssSelector
          } { /* ${bestEnergy} */\n${cssProps}\n}`
        );
      }
    }
    console.log('</style>');
    await page.evaluate(() => {
      document.documentElement.style.backgroundImage = null;
    });
  } finally {
    await browser.close();
  }
})();
