async function getWordPositions(page, elementHandle) {
  function getWordPositionsInBrowser(element) {
    function* generateTextNodes(element) {
      if (!element.childNodes) {
        return;
      }
      for (const childNode of Array.from(element.childNodes)) {
        if (childNode.nodeType === childNode.TEXT_NODE) {
          yield childNode;
        } else {
          yield* generateTextNodes(childNode);
        }
      }
    }

    function* generateWordRanges(textNode) {
      let position = 0;
      for (const unit of textNode.nodeValue.split(/(\s+)/)) {
        if (!/^\s*$/.test(unit)) {
          const range = document.createRange();
          range.setStart(textNode, position);
          range.setEnd(textNode, position + unit.length);
          yield range;
        }
        position += unit.length;
      }
    }

    // const selection = document.getSelection();
    const wordPositions = [];
    for (const textNode of generateTextNodes(element)) {
      for (const range of generateWordRanges(textNode)) {
        const clientRects = range.getClientRects()[0];
        if (clientRects) {
          const { width, height, left, right, top, bottom, x, y } = clientRects;
          wordPositions.push({ width, height, left, right, top, bottom, x, y });
        }
      }
    }
    return wordPositions;
  }

  return page.evaluate(
    // eslint-disable-next-line no-new-func
    new Function(
      'element',
      `
        return (${getWordPositionsInBrowser.toString()})(element);
      `
    ),
    elementHandle
  );
}

module.exports = getWordPositions;
