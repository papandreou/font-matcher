const _ = require('lodash');

const shorthandProps = new Set([
  'fontSize',
  'lineHeight',
  'fontWeight',
  'fontStyle',
  'fontFamily'
]);

function shorthandify(style) {
  let fontStyle = style.fontStyle;
  if (!fontStyle || fontStyle === 'normal') {
    fontStyle = '';
  }

  return {
    font: `${style.fontSize}/${style.lineHeight} ${fontStyle} ${
      style.fontWeight
    } "${style.fontFamily}"`.replace(/\s{2,}/g, ' '),
    ..._.pickBy(style, (value, prop) => !shorthandProps.has(prop))
  };
}

module.exports = shorthandify;
