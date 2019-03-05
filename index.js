#!/usr/bin/env node

const urlTools = require('urltools');
const puppeteer = require('puppeteer');
const pathModule = require('path');
const compareImages = require('resemblejs/compareImages');
const simulatedAnnealing = require('./simulatedAnnealing');
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

const increments = {
  fontSize: 1,
  lineHeight: 0.05,
  fontWeight: 100,
  letterSpacing: 0.05,
  wordSpacing: 0.05
};

const bounds = {
  fontSize: [5, 50],
  lineHeight: [0, 5],
  fontWeight: [100, 900],
  letterSpacing: [-2, 2],
  wordSpacing: [-2, 2]
};

async function optimize(page, elementHandles) {
  const referenceScreenshot = await page.screenshot();
  const pickPropertyToMutate = pickone(Object.keys(increments));
  const pickSign = pickone([-1, 1]);

  var result = await simulatedAnnealing({
    initialState: {
      fontSize: 18,
      lineHeight: 1.4,
      fontWeight: 300,
      letterSpacing: 0.7,
      wordSpacing: -0.15
    },
    tempMax: 15,
    tempMin: 0.001,
    newState(state) {
      const newState = { ...state };
      const propertyNameToMutate = pickPropertyToMutate.first();
      newState[propertyNameToMutate] +=
        pickSign.first() * increments[propertyNameToMutate];
      return newState;
    },
    getTemp,
    async getEnergy(state) {
      for (const elementHandle of elementHandles) {
        page.evaluate(
          (element, { fontSize, letterSpacing, wordSpacing, ...rest }) => {
            Object.assign(element.style, {
              fontFamily: 'Georgia',
              fontSize: `${fontSize}px`,
              letterSpacing: `${letterSpacing}px`,
              ...rest
            });
          },
          elementHandle,
          state
        );
      }
      const { rawMisMatchPercentage } = await compareImages(
        await page.screenshot(),
        referenceScreenshot,
        resembleJsCompareOptions
      );
      return rawMisMatchPercentage;
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
