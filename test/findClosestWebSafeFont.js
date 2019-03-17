const findClosestWebSafeFont = require('../findClosestWebSafeFont');
const puppeteer = require('puppeteer');
const pathModule = require('path');
const urlTools = require('urltools');
const promisify = require('util').promisify;
const writeFileAsync = promisify(require('fs').writeFile);
const mkdirAsync = promisify(require('fs').mkdir);
const rimrafAsync = promisify(require('rimraf'));
const os = require('os');

describe('findClosestWebSafeFont', function() {
  const tmpDir = pathModule.resolve(
    os.tmpdir(),
    `font-matcher-${Math.round(10000000 * Math.random())}`
  );
  before(async () => {
    try {
      await mkdirAsync(tmpDir);
    } catch (err) {}
  });
  after(async () => {
    try {
      await rimrafAsync(tmpDir);
    } catch (err) {}
  });

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
        const tmpFileName = pathModule.resolve(
          tmpDir,
          `${Math.round(10000000 * Math.random())}.html`
        );
        await writeFileAsync(
          tmpFileName,
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

        const page = await browser.newPage();
        await page.goto(urlTools.fsFilePathToFileUrl(tmpFileName));
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
