const simulatedAnnealing = require('./simulatedAnnealing');
const { pickone } = require('chance-generators');

async function compareRenderings(
  text,
  fontname1,
  fontname2,
  page,
  state = { xOffset: 0, yOffset: 0, fontSize: 50 },
  visual = false
) {
  /* global OffscreenCanvas */
  const difference = page.evaluate(
    async (
      { fontSize, xOffset, yOffset },
      text,
      fontname1,
      fontname2,
      visual
    ) => {
      let canvas;
      const width = 20 + text.length * 50;
      const height = 100;
      if (visual) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        document.body.appendChild(canvas);
      } else {
        canvas = new OffscreenCanvas(width, height);
      }

      const ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'xor';

      // ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `50px "${fontname1}"`;
      const letters = text.split(/(?:)/);
      for (const [i, letter] of letters.entries()) {
        ctx.fillText(letter, 10 + i * 50, 60);
      }
      ctx.font = `${fontSize}px "${fontname2}"`;
      for (const [i, letter] of letters.entries()) {
        ctx.fillText(letter, 10 + i * 50 + xOffset, 60 + yOffset);
      }
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        .data;
      let difference = 0;
      for (let i = 3; i < imageData.length; i += 4) {
        // Avoid counting antialiasing artifacts
        if (imageData[i] === 255) {
          difference += 1;
        }
      }
      if (visual) {
        // FIXME: This is just to show something interesting on the screen
        for (const oldCanvas of [...document.getElementsByTagName('canvas')]) {
          if (oldCanvas !== canvas) {
            document.body.removeChild(oldCanvas);
          }
        }
        canvas.style.zIndex = -10;
        // document.body.removeChild(canvas);
      }
      return difference;
    },
    state,
    text,
    fontname1,
    fontname2,
    visual
  );
  return difference;
}

async function findSmallestDifference(
  text,
  fontname1,
  fontname2,
  page,
  visual
) {
  const initialState = {
    yOffset: 0,
    xOffset: 0,
    fontSize: 50
  };

  const boundsByProp = {
    xOffset: [-10, 10],
    yOffset: [-10, 10],
    fontSize: [40, 60]
  };
  const pickSign = pickone([-1, 1]);

  const pickPropertyToMutate = pickone(Object.keys(boundsByProp));

  const [bestState, bestDifference] = await simulatedAnnealing({
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
        newValue < boundsByProp[prop][0] ||
        newValue > boundsByProp[prop][1]
      );
      newState[prop] = newValue;
      return newState;
    },
    // linear temperature decreasing
    getTemp(prevTemperature) {
      return prevTemperature - 0.08;
    },
    getEnergy(state) {
      return compareRenderings(text, fontname1, fontname2, page, state, visual);
    },
    onNewBestState(bestState, bestEnergy) {}
  });

  return bestDifference;
}

const genericFonts = ['serif', 'sans-serif', 'monospace'];

const websafeFontNames = [
  'Arial',
  'Calibri',
  'Century Gothic',
  'Comic Sans',
  'Consolas',
  'Courier',
  'Dejavu Sans',
  'Dejavu Serif',
  'Georgia',
  'Gill Sans',
  'Helvetica',
  'Impact',
  'Lucida Sans',
  'Myriad Pro',
  // 'Open Sans', // FIXME: Find out why Open Sans is detected as the best match for Merriweather!
  'Palatino',
  'Tahoma',
  'Times New Roman',
  'Trebuchet',
  'Verdana',
  'Zapfino'
];

async function findClosestWebSafeFont(webfontName, page, visual) {
  let lowestDifference;
  let bestWebsafeFontName;
  for (const websafeFontName of [...websafeFontNames, ...genericFonts]) {
    if (!genericFonts.includes(websafeFontName)) {
      const differences = await Promise.all(
        genericFonts.map(genericFont =>
          compareRenderings(
            'BESbwy',
            websafeFontName,
            genericFont,
            page,
            undefined,
            visual
          )
        )
      );
      if (differences.some(difference => difference === 0)) {
        // The font has an identical rendering to serif, sans-serif or monospace
        // https://www.bramstein.com/writing/detecting-system-fonts-without-flash.html
        // Assume it isn't available.
        continue;
      }
    }
    const difference = await findSmallestDifference(
      'BESbwy',
      webfontName,
      websafeFontName,
      page,
      visual
    );
    if (lowestDifference === undefined || difference < lowestDifference) {
      lowestDifference = difference;
      bestWebsafeFontName = websafeFontName;
    }
  }
  return bestWebsafeFontName;
}

module.exports = findClosestWebSafeFont;
