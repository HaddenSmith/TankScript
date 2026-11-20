import { fileURLToPath } from 'node:url';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';

// Optional test tools live in ignored generated/, never in application dependencies.
export async function launchJavaTestBrowser() {
  const engine=process.argv.find(arg=>arg.startsWith('--browser='))?.split('=')[1]??'chrome';
  if(engine==='chrome')return launchChrome({pauseNewTargets:false});
  if(!['firefox','webkit'].includes(engine))throw Error('Use --browser=chrome, firefox or webkit');
  process.env.PLAYWRIGHT_BROWSERS_PATH??=fileURLToPath(new URL('../../experiments/java-teavm/generated/browser-tools/browsers',import.meta.url));
  const playwright=await import('../../experiments/java-teavm/generated/browser-tools/node_modules/playwright/index.mjs');
  const browser=await playwright[engine].launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:1000},ignoreHTTPSErrors:process.argv.includes('--https')});
  const network=[],errors=[];
  context.on('response',response=>network.push({url:response.url(),status:response.status()}));
  context.on('page',page=>page.on('pageerror',error=>errors.push({message:error.message})));
  return {
    version:{Browser:engine+'/'+browser.version()},network,errors,
    async newPage(url){
      const page=await context.newPage();await page.goto(url);
      return {target:{sessionId:page},evaluate:expression=>page.evaluate(expression),
        screenshot:async()=>({data:(await page.screenshot()).toString('base64')}),close:()=>page.close()};
    },
    async send(method,params,page){
      if(method==='Page.navigate')return page.goto(params.url);
      if(method==='Page.reload')return page.reload();
      if(method==='Emulation.setDeviceMetricsOverride')return page.setViewportSize({width:params.width,height:params.height});
      throw Error('Unsupported test browser command: '+method);
    },
    close:()=>browser.close(),
  };
}
