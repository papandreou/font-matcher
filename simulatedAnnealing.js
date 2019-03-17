// async version of https://github.com/saveryanov/simulated-annealing/blob/master/index.js

module.exports = async function({
  initialState,
  tempMax,
  tempMin,
  newState,
  getTemp,
  getEnergy,
  onNewBestState
} = {}) {
  let currentTemp = tempMax;

  let lastState = initialState;
  let lastEnergy = await getEnergy(lastState);

  let bestState = lastState;
  let bestEnergy = lastEnergy;

  while (currentTemp > tempMin) {
    const currentState = newState(lastState);
    const currentEnergy = await getEnergy(currentState);

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
      if (onNewBestState) {
        await onNewBestState(bestState, bestEnergy);
      }
    }
    currentTemp = getTemp(currentTemp);
  }
  return [bestState, bestEnergy];
};
