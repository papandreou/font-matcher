const findClosestWebSafeFont = require('../findClosestWebSafeFont');
const puppeteer = require('puppeteer');

describe('findClosestWebSafeFont', function() {
  let browser;
  before(async function() {
    browser = await puppeteer.launch({ headless: false });
  });
  after(async function() {
    await browser.close();
  });

  const expect = require('unexpected')
    .clone()
    .addAssertion(
      '<string> to result in fallback <string>',
      async (expect, webfontName, fallbackName) => {
        const page = await browser.newPage();
        await page.setContent(
          `
            <!DOCTYPE html>
            <html>
              <head>
                <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=${webfontName}:300,300i,400,400i,700,700i,900,900i">
              </head>
              <body></body>
            </html>
          `,
          'utf-8'
        );

        expect(
          await findClosestWebSafeFont(webfontName, page),
          'to equal',
          fallbackName
        );
      }
    );

  this.timeout(99999999);

  it('should Open Sans as a fallback for Merriweather', async function() {
    await expect('Merriweather', 'to result in fallback', 'serif');
  });
});
