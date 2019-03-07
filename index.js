#!/usr/bin/env node

const urlTools = require('urltools');
const puppeteer = require('puppeteer');
const pathModule = require('path');
const compareImages = require('resemblejs/compareImages');
const simulatedAnnealing = require('./simulatedAnnealing');
const getWordPositions = require('./getWordPositions');
const { pickone } = require('chance-generators');

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

const boundsByProp = {
  fontSize: [5, 50],
  lineHeight: [0, 5],
  fontWeight: [100, 900],
  letterSpacing: [-2, 2],
  wordSpacing: [-2, 2]
};

const numStepsByProp = {};
for (const [prop, [min, max]] of Object.entries(boundsByProp)) {
  numStepsByProp[prop] = (max - min) / incrementByProp[prop] + 1;
}

const pxProps = new Set(['fontSize', 'letterSpacing']);

function stringifyProp(prop, value) {
  const numericalValue = boundsByProp[prop][0] + incrementByProp[prop] * value;
  const unit = pxProps.has(prop) ? 'px' : '';
  return `${numericalValue.toFixed(4)}${unit}`;
}

function stateToStyle(state) {
  const style = {
    fontFamily: 'Georgia'
  };
  for (const prop of Object.keys(incrementByProp)) {
    style[prop] = stringifyProp(prop, state[prop]);
  }
  return style;
}

function distance(a, b) {
  return (
    Math.sqrt((a.left - b.left) ** 2 + (a.top - b.top) ** 2) +
    Math.sqrt((a.right - b.right) ** 2 + (a.bottom - b.bottom) ** 2)
  );
}

async function optimize(page, elementHandles) {
  const referenceScreenshot = await page.screenshot();
  const pickPropertyToMutate = pickone(Object.keys(incrementByProp));
  await page.evaluate(imageUrl => {
    document.documentElement.style.backgroundImage = imageUrl;
  }, `url(data:image/png;base64,${referenceScreenshot.toString('base64')})`);

  const pickSign = pickone([-1, 1]);

  const referenceWordPositions = await Promise.all(
    elementHandles.map(elementHandle => getWordPositions(page, elementHandle))
  );

  const initialState = {};
  for (const [prop, numSteps] of Object.entries(numStepsByProp)) {
    // initialState[prop] = Math.round(Math.random() * numSteps);
    initialState[prop] = numSteps >> 1;
  }

  const bestState = await simulatedAnnealing({
    initialState,
    tempMax: 15,
    tempMin: 0.001,
    newState(state) {
      const newState = { ...state };
      let prop;
      let newValue;
      do {
        prop = pickPropertyToMutate.first();
        newValue = state[prop] + pickSign.first();
      } while (
        newValue >= boundsByProp[prop][0] &&
        newValue <= boundsByProp[prop][1]
      );
      newState[prop] = newValue;
      return newState;
    },
    getTemp,
    async getEnergy(state) {
      const style = stateToStyle(state);
      let sumDistances = 0;
      for (const [i, elementHandle] of elementHandles.entries()) {
        await page.evaluate(
          (element, style) => Object.assign(element.style, style),
          elementHandle,
          style
        );
        const wordPositions = await getWordPositions(page, elementHandle);

        for (const [j, wordPosition] of wordPositions.entries()) {
          sumDistances += distance(wordPosition, referenceWordPositions[i][j]);
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
      'merriweather',
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
      () => fontTracer(document)
    );
    const traces = await transferResults(jsHandle);

    const merriweatherTraces = traces.filter(trace =>
      /\bMerriweather\b/i.test(trace.props['font-family'])
    );
    const elementHandles = merriweatherTraces.map(trace => trace.node);
    await optimize(page, elementHandles);
    // const boundingBox = await elementHandle.boundingBox();
  } finally {
    await browser.close();
  }
})();
