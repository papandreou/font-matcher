#!/usr/bin/env node

const urlTools = require('urltools');
const puppeteer = require('puppeteer');
const pathModule = require('path');
const writeFile = require('util').promisify(require('fs').writeFile);
const _ = require('lodash');
const compareImages = require('resemblejs/compareImages');
const simulatedAnnealing = require('./simulatedAnnealing');
const getWordPositions = require('./getWordPositions');
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

const resembleJsCompareOptions = {
  output: {
    errorColor: {
      red: 255,
      green: 0,
      blue: 255
    },
    errorType: 'movement',
    transparency: 0.3,
    largeImageThreshold: 1200,
    useCrossOrigin: false,
    outputDiff: true
  },
  scaleToSameSize: true,
  ignore: 'antialiasing'
};

// linear temperature decreasing
function getTemp(prevTemperature) {
  return prevTemperature - 0.001;
}

const incrementByProp = {
  fontSize: 1,
  lineHeight: 0.05,
  fontWeight: 100,
  letterSpacing: 0.05,
  wordSpacing: 0.05
};

const pxProps = new Set(['fontSize', 'letterSpacing', 'wordSpacing']);

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

function stateToStyle(state, boundsByProp) {
  const style = {
    fontFamily: 'Georgia',
    mixBlendMode: 'screen'
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
    traceGroup.referenceWordPositions = await Promise.all(
      traceGroup.elementHandles.map(elementHandle =>
        getWordPositions(page, elementHandle)
      )
    );

    const fontSize = parseFloat(traceGroup.originalStyle.fontSize);

    traceGroup.boundsByProp = {
      fontSize: [Math.round(fontSize / 2), Math.round(fontSize * 2)],
      lineHeight: [0, 5],
      fontWeight: [100, 900],
      letterSpacing: [-2, 2],
      wordSpacing: [-2, 2]
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
    async onNewBestState(bestState, bestScore) {
      console.log(
        'new best',
        bestState.map((traceGroupState, i) =>
          stateToStyle(traceGroupState, traceGroups[i].boundsByProp)
        )
      );
      await writeFile('best.png', await page.screenshot());
      page.evaluate(
        bestScore => (document.title = `Best: ${bestScore}`),
        bestScore
      );
    },
    async getEnergy(state) {
      let sumDistances = 0;
      for (const [
        i,
        { elementHandles, referenceWordPositions, boundsByProp }
      ] of traceGroups.entries()) {
        const style = stateToStyle(state[i], boundsByProp);
        for (const [j, elementHandle] of elementHandles.entries()) {
          await page.evaluate(
            (element, style) => Object.assign(element.style, style),
            elementHandle,
            style
          );
          const wordPositions = await getWordPositions(page, elementHandle);

          for (const [k, wordPosition] of wordPositions.entries()) {
            sumDistances += distance(
              wordPosition,
              referenceWordPositions[j][k]
            );
          }
        }
      }

      return sumDistances;

      // The image comparison is quite slow, skip it for now:
      const { rawMisMatchPercentage } = await compareImages(
        await page.screenshot(),
        referenceScreenshot,
        resembleJsCompareOptions
      );
      return sumDistances + rawMisMatchPercentage;
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
      'multipleSizes',
      'index.html'
    );

    await page.goto(urlTools.fsFilePathToFileUrl(fileName));
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

    for (const trace of traces) {
      const computedStyle = await page.evaluate(
        node => ({ ...window.getComputedStyle(node) }),
        trace.node
      );
      trace.originalStyle = _.pick(
        computedStyle,
        fontRelatedProps.map(_.camelCase)
      );
    }
    const traceGroups = Object.values(
      _.groupBy(traces, trace =>
        Object.values(trace.originalStyle).join('\x1e')
      )
    )
      .map(traces => ({
        originalStyle: traces[0].originalStyle,
        elementHandles: _.map(traces, 'node'),
        traces
      }))
      .filter(traceGroup =>
        /merriweather/i.test(traceGroup.originalStyle.fontFamily)
      );
    if (traceGroups.length === 0) {
      throw new Error('No webfonts to optimize');
    }
    await optimize(page, traceGroups);
  } finally {
    await browser.close();
  }
})();
