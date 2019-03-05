// async version of https://github.com/saveryanov/simulated-annealing/blob/master/index.js

module.exports = async function({
  initialState,
  tempMax,
  tempMin,
  newState,
  getTemp,
  getEnergy
} = {}) {
  var currentTemp = tempMax;

  var lastState = initialState;
  var lastEnergy = await getEnergy(lastState);

  var bestState = lastState;
  var bestEnergy = lastEnergy;

  while (currentTemp > tempMin) {
    let currentState = newState(lastState);
    let currentEnergy = await getEnergy(currentState);

    if (currentEnergy < lastEnergy) {
      lastState = currentState;
      lastEnergy = currentEnergy;
    } else {
      if (
        Math.random() <= Math.exp(-(currentEnergy - lastEnergy) / currentTemp)
      ) {
        lastState = currentState;
        lastEnergy = currentEnergy;
      }
    }

    if (bestEnergy > lastEnergy) {
      bestState = lastState;
      bestEnergy = lastEnergy;
    }
    currentTemp = getTemp(currentTemp);
  }
  return bestState;
};
