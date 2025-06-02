
import { build } from 'esbuild';
import vm from 'vm';

import { Page } from 'playwright';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { boolean, z } from "zod";
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import 'ts-node/register';
import path from 'path';
import { pathToFileURL,fileURLToPath } from 'url';

import { dirname } from 'path';

// 获取 __dirname 等效值
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { logger } from './logger.js';
import { AgentInterface, remoteAgent } from './loginUtils.js';
import { AgentContext } from './AgentContext.js';

// 动态编译并执行 TypeScript 代码的辅助函数
async function compileAndRunTS(scriptFilePath: string, options: any) {
    const result = await build({
        entryPoints: [scriptFilePath],
        write: false,
        bundle: true,
        format: 'esm',
        platform: 'node',
    });

    const moduleCode = result.outputFiles[0].text;
    const module = { exports: {} };
    const context = {
        require,
        module,
        exports: module.exports,
        __dirname,
        __filename,
    };

    const script = new vm.Script(moduleCode);
    script.runInNewContext(context);

    // 使用类型断言
    const moduleExports = context.module.exports as { run: (options: any) => Promise<string> };
    if (typeof moduleExports.run !== 'function') {
        throw new Error('脚本必须导出一个 `run` 函数');
    }

    return moduleExports.run(options);
}


async function getBrowserAgent(): Promise<AgentInterface> {
    const hostUrl = `http://${process.env.REMOTE_BROWSER_HOST ?? "localhost"}`;
    const remoteBrowserPort = Number(process.env.REMOTE_BROWSER_PORT) || 9222;
    try {
        const loginAgent = new remoteAgent(hostUrl, remoteBrowserPort);
        await loginAgent.setUp();
        return loginAgent;
    }
    catch (error) {
        throw error;
    }
}


// 任务管理对象
const playwrightTasks: {
    [taskId: string]: {
      status: 'pending' | 'completed' | 'failed';
      result?: any;
      error?: Error;
    };
  } = {};

function preprocess(content: string, inputData: Record<string, any>): string {
    return content.replace(/\$\{(\w+)\}/g, (match, key) => {
      return inputData[key] !== undefined ? inputData[key] : match;
    });
}


async function replay(userFlowfileName: string,inputData:Record<string,any>,page: Page,agentContext:AgentContext,taskId:string): Promise<boolean> {
    if (!page)
        return false;

    const userFlowfilePath = path.join(
        await AgentContext.getUserFlowJsonDir(),
        userFlowfileName
    );

    try {
      const content = preprocess(await fs.readFile(userFlowfilePath, 'utf-8'),inputData);
      const actions = JSON.parse(content);
      const steps = actions.steps || [];

      let stepCount = 0;
      for (const step of steps) {
        const actionType = step.type;
        const selectors = step.selectors || [];
        const timeout = step.timeout || 5000; // 默认超时时间 5 秒
        const assertedEvents = step.assertedEvents || [];

        let selectedSelector: string | null = null;
        let selectedElement: any = null;

        try {
          // 循环尝试每个选择器
          for (const selectorItem of selectors) {            
            let selector:string;
            // 检查 selectorItem 是否为数组
            if (Array.isArray(selectorItem)) {
                selector = selectorItem[0];
              } else {
                selector = selectorItem;
            }

            // 跳过 aria 选择器
            if (selector.startsWith('aria') || selector.startsWith('pierce') || selector.startsWith('text')) {
              continue;
            }else if(selector.startsWith('xpath')){
                // 修正 XPath 选择器格式
                selector = `xpath=${selector.slice(6)}`;  
            }else{
                // 修正 CSS 选择器格式 
                // selector = `css=${selector}`;
            }


            try {
              // 检查元素是否存在
              selectedElement = await page.locator(selector);
              if (selectedElement) {
                selectedSelector = selector;
                break;
              }
            } catch (error) {
              // 忽略错误，尝试下一个选择器
              logger.error(`step<${stepCount}>:Error checking selector ${selector}:`, error);
              continue;
            }
            logger.error(`Selector ${selector} not found at step<${stepCount}>. Trying next selector...`);
          }

          if (selectors.length !== 0 && !selectedSelector) {
            throw new Error(`No valid selector found for this step<${stepCount}>: ${JSON.stringify(step)}`);
          }

          switch (actionType) {
            case 'navigate': {
              const url = step.url;
              logger.info(`Navigating to ${url}`);
              await page.goto(url, { timeout });
              break;
            }
            case 'click': {
              const { offsetX = 0, offsetY = 0 } = step;
              logger.info(`Clicking on ${selectedSelector} at offset (${offsetX}, ${offsetY})`);

              if(selectedElement==null ||selectedSelector==null){
                throw new Error(`No valid selector found for this step<${stepCount}>: ${JSON.stringify(step)}`);
              }

              await selectedElement.click({ timeout, position: { x: offsetX, y: offsetY } });
              break;
            }
            case 'doubleClick': {
              const { offsetX = 0, offsetY = 0 } = step;
              logger.info(`Double clicking on ${selectedSelector} at offset (${offsetX}, ${offsetY})`);

              if(selectedElement==null ||selectedSelector==null){
                throw new Error(`No valid selector found for this step<${stepCount}>: ${JSON.stringify(step)}`);
              }

              await selectedElement.dblclick({ timeout, position: { x: offsetX, y: offsetY } });
              break;
            }
            case 'change': {
              const value = step.value;
              logger.info(`Changing value of ${selectedSelector} to ${value}`);

              if(selectedElement==null ||selectedSelector==null){
                throw new Error(`No valid selector found for this step<${stepCount}>: ${JSON.stringify(step)}`);
              }

              await selectedElement.fill(value, { timeout });              
              break;
            }
            case 'close':
              logger.info('Closing the page');
              await page.close({ runBeforeUnload: false });
              break;
            case 'customStep': {
              const { name, parameters } = step;
              logger.info(`Executing custom step: ${name} with parameters: ${JSON.stringify(parameters)}`);
              // 自定义步骤需要根据实际情况实现
              break;
            }
            case 'hover':{
              logger.info(`Hovering over ${selectedSelector}`);

              if(selectedElement==null ||selectedSelector==null){
                throw new Error(`No valid selector found for this step<${stepCount}>: ${JSON.stringify(step)}`);
              }

              await selectedElement.hover({ timeout });
              break;
            }
            case 'keyDown':{
              const key = step.key;
              logger.info(`Pressing key ${key}`);
              await page.keyboard.down(key);
              break;
            }
            case 'keyUp': {
              const key = step.key;
              logger.info(`Releasing key ${key}`);
              await page.keyboard.up(key);
              break;
            }
            case 'scroll': {
              const { x = 0, y = 0 } = step;
              logger.info(`Scrolling to x: ${x}, y: ${y}`);
              await page.evaluate(({ x, y }) => {
                window.scrollTo(x, y);
              }, { x, y });
              break;
            }
            case 'setViewport': {
              const { width, height, deviceScaleFactor, isMobile, hasTouch, isLandscape } = step;
              logger.info(`Setting viewport to width: ${width}, height: ${height}`);
              // 设置视口尺寸
              await page.setViewportSize({
                width,
                height
              });

              // 构建媒体特性数组
              const mediaFeatures: { name: string; value: string | number | boolean }[] = [];
              if (deviceScaleFactor !== undefined) {
                mediaFeatures.push({ name: 'device-pixel-ratio', value: deviceScaleFactor });
              }
              if (isMobile !== undefined) {
                mediaFeatures.push({ name: 'hover', value: isMobile ? 'none' : 'hover' });
                mediaFeatures.push({ name: 'pointer', value: isMobile ? 'coarse' : 'fine' });
              }
              if (hasTouch !== undefined) {
                mediaFeatures.push({ name: 'pointer', value: hasTouch ? 'coarse' : 'fine' });
              }
              if (isLandscape !== undefined) {
                mediaFeatures.push({ name: 'orientation', value: isLandscape ? 'landscape' : 'portrait' });
              }

              if (mediaFeatures.length > 0) {
                // 使用 page.emulateMediaFeatures 设置媒体特性
                // await page.emulateMediaFeatures(mediaFeatures);
              }
              break;
            }
            case 'waitForElement': {
                if(selectedElement==null ||selectedSelector==null){
                    throw new Error(`No valid selector found for this step<${stepCount}>: ${JSON.stringify(step)}`);
                }    

                const { 
                    operator = '==', 
                    count = 1, 
                    visible = true, 
                    properties = {}, 
                    attributes = {} 
                } = step;
                let waitForSelectorOptions: { timeout: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' } = { timeout };
                if (visible) {
                    waitForSelectorOptions.state = 'visible';
                }
                logger.info(`Waiting for element ${selectedSelector} with operator ${operator}, count ${count}`);
                await page.waitForSelector(selectedSelector, waitForSelectorOptions);
                // 处理 operator 和 count 逻辑
                await page.waitForFunction(
                    ({ selector, operator, count }) => {
                    const elements = document.querySelectorAll(selector);
                    const elementCount = elements.length;
                    switch (operator) {
                        case '==': return elementCount === count;
                        case '!=': return elementCount !== count;
                        case '>': return elementCount > count;
                        case '<': return elementCount < count;
                        case '>=': return elementCount >= count;
                        case '<=': return elementCount <= count;
                        default: return false;
                    }
                    },
                    { selector: selectedSelector, operator, count },
                    { timeout }
                );
                // 处理 properties 和 attributes
                if (Object.keys(properties).length > 0) {
                    await page.waitForFunction(
                    // 明确参数类型
                    ({ selector, properties }: { selector: string; properties: Record<string, any> }) => {
                        const element = document.querySelector(selector);
                        if (!element) return false;
                        // 将 element 转换为 HTMLElement 类型
                        const htmlElement = element as HTMLElement;
                        for (const [key, value] of Object.entries(properties)) {
                        // 使用 Reflect.get 安全地访问属性
                        if (Reflect.get(htmlElement, key) !== value) return false;
                        }
                        return true;
                    },
                    { selector: selectedSelector, properties },
                    { timeout }
                    );
                }
                if (Object.keys(attributes).length > 0) {
                    await page.waitForFunction(
                    // 明确参数类型
                    ({ selector, attributes }: { selector: string; attributes: Record<string, string | null> }) => {
                        const element = document.querySelector(selector);
                        if (!element) return false;
                        // 将 element 转换为 HTMLElement 类型
                        const htmlElement = element as HTMLElement;
                        for (const [key, value] of Object.entries(attributes)) {
                        // 使用 getAttribute 方法获取属性值
                        if (htmlElement.getAttribute(key) !== value) return false;
                        }
                        return true;
                    },
                    { selector: selectedSelector, attributes },
                    { timeout }
                    );
                }
                break;
            }
            case 'waitForExpression': {
              const expression = step.expression;
              logger.info(`Waiting for expression ${expression} with timeout ${timeout}ms`);
              await page.waitForFunction(expression, null, { timeout });
              break;
            }
            default:
              logger.error(`Unsupported action type: ${actionType}`);
          }

          // 处理 assertedEvents
          for (const event of assertedEvents) {
            switch (event.type) {
              case 'elementBoundingBox':
                logger.info(`Asserting element ${event.selector} bounding box`);
                await page.waitForSelector(event.selector, { timeout });
                break;
              case 'elementCount':
                logger.info(`Asserting element ${event.selector} count is ${event.count}`);
                await page.waitForFunction(
                  // 明确参数类型，函数会在浏览器上下文中执行
                  ({ selector, count }: { selector: string; count: number }) => {
                    const elements = document.querySelectorAll(selector);
                    return elements.length === count;
                  },
                  // 传递包含参数的对象
                  { selector: event.selector, count: event.count },
                  { timeout }
                );
                break;
              case 'elementText':
                logger.info(`Asserting element ${event.selector} text is ${event.text}`);
                await page.waitForFunction(
                  // 明确参数类型，函数会在浏览器上下文中执行
                  ({ selector, text }: { selector: string; text: string }) => {
                    const element = document.querySelector(selector);
                    return element?.textContent === text;
                  },
                  // 传递包含参数的对象
                  { selector: event.selector, text: event.text },
                  { timeout }
                );
                break;
              case 'navigation':
                logger.info(`Asserting navigation to ${event.url}`);
                await page.waitForURL(event.url, { timeout });
                break;
              default:
                logger.info(`Unsupported asserted event type: ${event.type}`);
            }
          }
        } catch (error) {
            logger.error(`Step<${stepCount}>Error executing action ${actionType}:`, error);
            throw error;
        }
        
        stepCount++;
      }

      logger.error('replayCompleted', '回放已完成');
      playwrightTasks[taskId] = {
        status: 'completed',
        result: {
            successReplay: true
        }
      };
      return true;
    } catch (error) {
      logger.error('回放失败:', error);

      playwrightTasks[taskId] = {
        status: 'failed',
        error: error as Error
      };
      return false;      
    }
  }


export async function createServer(): Promise<{ server: McpServer; browserAgent: AgentInterface }> {
    let browserAgent;
    try {
        browserAgent = await getBrowserAgent();
    }
    catch (error) {
        logger.error('Failed to initialize browserAgent:', error);
        throw new Error("Browser agent cannot be initialized.");
    }
    const browserContext = browserAgent.getContext();
    if (!browserContext) {
        logger.error('Browser context is not initialized.');
        throw new Error('Browser context is not initialized.');
    }
    const agentContext = new AgentContext(browserContext);
    const server = new McpServer({
        name: "contextBrowserServer",
        version: "0.1.0",
    });
    // 1. open a new page with specified url
    server.tool("navigate", "Navigate to a URL", {
        url: z.string().describe("URL to navigate to the website specified"),
    }, async ({ url }) => {
        if (!url) {
            throw new Error("url is required.");
        }
        const page = await agentContext.getCurrentPage();
        await page.goto(url);
        return {
            content: [
                {
                    type: "text",
                    // 将 JSON 对象转换为字符串,返回.
                    text: JSON.stringify({pageUrl: url }),
                },
            ],
        };
    });
    // 2. snapshot a elemnt or the whole page.
    server.tool(
        "snapshot",
        "Take a screenshot of a page or an element",
        {
            selector: z.string().optional().describe("The selector for the element to screenshot. If null, screenshot the whole page."),
            width: z.number().optional().describe("The width of the screenshot. If null, use the element's width or viewport width."),
            height: z.number().optional().describe("The height of the screenshot. If null, use the element's height or viewport height."),
            offsetX: z.number().optional().describe("The horizontal offset from the top-left corner of the element or page. If null, default to 0."),
            offsetY: z.number().optional().describe("The vertical offset from the top-left corner of the element or page. If null, default to 0."),
        },
        async ({selector,width, height, offsetX = 0, offsetY = 0 }) => {
            const page = await agentContext.getCurrentPage();
            if (!page) {
                throw new Error('No page opened.');
            }
    
            const imageUniqueName = randomUUID();
            // 调用 AgentContext 的静态方法获取图片目录路径
            const imagesDir = await AgentContext.getImagesDir(); // 使用 await 等待异步操作
            const snapshotImage = path.join(imagesDir, `${imageUniqueName}.png`);
    
            // 明确 screenshotOptions 类型
            let screenshotOptions: Parameters<Page['screenshot']>[0] = { path: snapshotImage };
    
            if (selector) {
                const element = await page.$(selector);
                if (!element) {
                    throw new Error('Element not found');
                }
    
                const boundingBox = await element.boundingBox();
                if (!boundingBox) {
                    throw new Error('Could not get element bounding box');
                }
    
                // 计算截图区域
                const clip = {
                    x: boundingBox.x + (offsetX || 0),
                    y: boundingBox.y + (offsetY || 0),
                    width: width || boundingBox.width,
                    height: height || boundingBox.height,
                };
                screenshotOptions.clip = clip;
            } else {
                // 没有 selector 时，截图整个页面
                if (width || height) {
                    const viewportSize = page.viewportSize();
                    screenshotOptions.clip = {
                        x: offsetX,
                        y: offsetY,
                        width: width || viewportSize?.width || 0,
                        height: height || viewportSize?.height || 0,
                    };
                }
            }
    
            await page.screenshot(screenshotOptions);
            return {
                content: [
                    {
                        type: "text",
                        // 将 JSON 对象转换为字符串,返回.
                        text: JSON.stringify({ snapshotImage }),
                    },
                ],
            };
        },
    );
    
    // 3. get All Pages in browser工具
    server.tool(
        "getAllPages",
        "return all open pages",
        {},
        async () => {
            const pagesInfo = [];
            const browserContext = browserAgent.getContext();
            if (!browserContext) {
                throw new Error('Browser context not found');
            }
    
            // 获取 browserAgent 上下文中的所有页面
            const browserPages = browserContext.pages();
            const currentPage = await agentContext.getCurrentPage();

            let currentPageIndex: number = 0;
            for (const browserPage of browserPages) {
                // 移除不必要的 await
                const url = browserPage.url(); 
                pagesInfo.push({ url });
                if (browserPage === currentPage) {
                    currentPageIndex = pagesInfo.length - 1;
                }                
            }
            
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ pagesInfo, currentPageIndex }),
                    },
                ],
            };
        }
    );
    
    // 4. click 工具
    server.tool(
        "click",
        "Click an element on the page",
        {
            selector: z.string().describe("CSS selector for the element to click")
        },
        async ({selector }) => {
            const timeOutMSeconds: number = Number(process.env.TIMEOUT_MSECOND_FOR_NEW_PAGE) || 2000;            
    
            const page = await agentContext.getCurrentPage();
            if (!page) {
                throw new Error('Page not found');
            }
            const element = await page.$(selector);
            if (!element) {
                throw new Error('Element not found');
            }
    
            let newPage: Page | null = null;
            // 监听新页面打开事件
            const newPagePromise = new Promise<Page>((resolve) => {
                const listener = (newPage: Page) => {
                    page.context().off('page', listener);
                    resolve(newPage);
                };
                page.context().on('page', listener);
            });
    
            // 执行点击操作
            await element.click();
    
            // 等待一段时间看是否有新页面打开
            try {
                newPage = await Promise.race([newPagePromise, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeOutMSeconds))]);
            } catch (error) {
                logger.error('Error waiting for new page:', error);
            }
    
            if (newPage) {
                // 这种情况下，需啊哟移除以前的page.
                await agentContext.setCurrentPage(newPage);

                // 移除不必要的 await
                const newPageUrl = newPage.url(); 
                return {
                        content: [
                        {
                            type: "text",
                            text: JSON.stringify({ message: "A new page is generated after clicking", newPage: { pageUrl: newPageUrl } }),
                        },
                    ],
                };
            }
    
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ message: "Element clicked successfully" }),
                    },
                ],
            };
        }
    );
    
    // 5. fill 工具
    server.tool("fill", "fill out an input field", {
        selector: z.string().describe("CSS selector for input field"),
        value: z.string().describe("Value to fill"),
    }, async ({selector, value }) => {
        const page = await agentContext.getCurrentPage();
        if (!page) {
            throw new Error('Page not found');
        }
        const element = await page.$(selector);
        if (!element) {
            throw new Error('Input field not found');
        }
        await element.fill(value);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ message: "Input field filled successfully" }),
                },
            ],
        };
    });
    // 6. select 工具
    server.tool("select", "Select an element on the page with Select tag", {
        selector: z.string().describe("CSS selector for element to select"),
        value: z.string().describe("Value to select"),
    }, async ({selector, value }) => {
        const page = await agentContext.getCurrentPage();
        if (!page) {
            throw new Error('Page not found');
        }
        const element = await page.$(selector);
        if (!element) {
            throw new Error('Select element not found');
        }
        await element.selectOption(value);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ message: "Option selected successfully" }),
                },
            ],
        };
    });
    // 7. hover 工具
    server.tool("hover", "Hover an element on the page", {
        selector: z.string().describe("CSS selector for element to hover"),
    }, async ({ selector }) => {
        const page = await agentContext.getCurrentPage();
        if (!page) {
            throw new Error('Page not found');
        }
        const element = await page.$(selector);
        if (!element) {
            throw new Error('Element not found');
        }
        await element.hover();
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ message: "Element hovered successfully" }),
                },
            ],
        };
    });
    // 8. evaluate 工具
    server.tool("evaluate", "Execute JavaScript in the browser console", {
        script: z.string().describe("JavaScript code to execute"),
    }, async ({ script }) => {
        const page = await agentContext.getCurrentPage();
        if (!page) {
            throw new Error('Page not found');
        }
        const result = await page.evaluate(script);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result),
                },
            ],
        };
    });
    
    // 9. getTexts 工具
    server.tool("getTexts", "get all human readable texts of elements on page", {
        selector: z.string().describe("CSS selector for the element to get texts"),
    }, async ({selector }) => {
        const page = await agentContext.getCurrentPage();

        if (!page) {
            throw new Error('Page not found');
        }
        const elements = await page.$$(selector);
        const texts = [];
        for (const element of elements) {
            const text = await element.textContent();
            texts.push({ text: text || '' });
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ texts }),
                },
            ],
        };
    });

    // 10. getHTML 工具
    server.tool("getHTML", "Get the HTML content specified by selector. If selector is null, return whole html of the page", {
        selector: z.string().optional().describe("CSS selector for the element to get HTML texts. Or HTML text of the page if null.")
    }, async ({ selector }) => {
        const page = await agentContext.getCurrentPage();

        if (!page) {
            throw new Error('Page not found');
        }
        let htmlContent;
        if (selector) {
            const element = await page.$(selector);
            if (!element) {
                throw new Error('Element not found');
            }
            htmlContent = await element.innerHTML();
        }
        else {
            htmlContent = await page.content();
        }
        return {
            content: [
                {
                    type: "text",
                    text: htmlContent,
                },
            ],
        };
    });

    // 11. focusPage 工具
    server.tool("focusPage", "set the specified page as the current page and let it to be visible in the browser", {
        urlSubstring: z.string().describe("The sub-string of url of the page to focus and set as the current page."),
    }, async ({urlSubstring}) => {
        const browserPages=browserAgent.getContext()?.pages();
        if (!browserPages) {
            throw new Error('Browser context not found');
        }

        let page: Page | null = null;
        for (const browserPage of browserPages) {
            const url = browserPage.url();
            if (url.includes(urlSubstring)) {
                page = browserPage;
                break;
            }
        }
        if (!page) {
            throw new Error('Page not found');
        }

        await page.bringToFront();
        await agentContext.setCurrentPage(page);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ message: "Set the page as current page and focused it successfully" }),
                },
            ],
        };
    });

    // 12.run playwright code
      server.tool("runCompiledPlaywrightCode", "run playwright web auto code stored in a .ts file. The .ts code must follow externScripts/scriptTemplate.ts.", {
        scriptFile: z.string().describe(`The .ts file of playwright web auto code script file. The file path is relative to src/externScripts/}`)
    }, async ({ scriptFile }) => {
        const taskId = randomUUID();
        playwrightTasks[taskId] = {
            status: 'pending'
            };

        // 异步执行脚本
        (async () => {
            try {
                // 将 .ts 替换为 .js
                const jsScriptFile = scriptFile.replace(/\.ts$/, '.js');
                // 构建编译后的文件路径
                const projectRoot = path.resolve(__dirname, '../');
                const compiledScriptFilePath = path.join(
                    projectRoot,
                    'dist',
                    'externScripts',
                    jsScriptFile
                );
                const scriptFileUrl = pathToFileURL(compiledScriptFilePath).href;
                logger.error(`imported script:${scriptFileUrl}`);

                const scriptTS = await import(scriptFileUrl);
                
                if (typeof scriptTS.run !== 'function') {
                    throw new Error('脚本必须导出一个 `run` 函数');
                }

                const page = await agentContext.getCurrentPage();
            
                // 调用 run 并传入参数
                const jsonString = await scriptTS.run({
                    browser: browserAgent.getBrowser(),
                    context: browserAgent.getContext(),
                    page: page,
                    customData: { searchText: "adxl345" }, // 可选自定义参数
                });
            
                // 解析 JSON
                const result = JSON.parse(jsonString);
                console.error('脚本执行结果:', result);

                playwrightTasks[taskId] = {
                    status: 'completed',
                    result: {
                        isCodeRun: true,
                        codeRunResult: result
                    }
                };
            } catch (error) {
                console.error('执行脚本失败:', error);
                playwrightTasks[taskId] = {
                    status: 'failed',
                    error: error as Error
                };
            }
        })();

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ taskId, message: '任务已启动，可通过 checkPlaywrightTaskStatus 工具查询状态' }),
                },
            ],
        };
    });

    // 新增查询任务状态的工具
    server.tool("checkPlaywrightTaskStatus", "Check the status and result of a playwright task", {
        taskId: z.string().describe("The task ID returned by runCompiledPlaywrightCode")
    }, async ({ taskId }) => {
        const task = playwrightTasks[taskId];
        if (!task) {
            throw new Error('任务 ID 不存在');
        }

        if (task.status === 'pending') {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ taskId, status: 'pending', message: '任务正在执行中' }),
                    },
                ],
            };
        } else if (task.status === 'completed') {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ taskId, status: 'completed', result: task.result }),
                    },
                ],
            };
        } else { // failed
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ taskId, status: 'failed', error: task.error?.message }),
                    },
                ],
            };
        }
    });

  
    // 13. run playwright code JIT.
    server.tool("runCompiledPlaywrightCodeJIT", "Compile .ts source file and run it. Source code must follow externScripts/scriptTemplate.ts.", {
        scriptFile: z.string().describe(`The .ts file of playwright web auto code script file. The file path is relative to src/externScripts/}`)
    }, async ({ scriptFile }) => {
        try {
            // 构建编译后的文件路径
            const projectRoot = path.resolve(__dirname, '../src/externScripts/');            
            const scriptFilePath = path.join(projectRoot,scriptFile);
    
            const jsonString = await compileAndRunTS(scriptFilePath, {
                browser: browserAgent.getBrowser(),
                context: browserAgent.getContext(),
                page: agentContext.getCurrentPage(),
                customData: { userId: 123 }, // 可选自定义参数
            });
    
            // 解析 JSON
            const result = JSON.parse(jsonString);
            console.error('脚本执行结果:', result);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ isCodeRun: true, codeRunResult: result }),
                    },
                ],
            };
        } catch (error) {
            console.error('执行脚本失败:', error);
            throw error;
        }
    });

    // 14. get user-flow input_schema.
    server.tool("getInputSchemaOfUserFlow", "get input schema for a user-flow.", {
        userFlowJsonFile: z.string().describe("The user flow json file. The file path is relative to src/recordUserFlow/}`"),
    }, async ({ userFlowJsonFile }) => {
        const userFlowJsonFilePath = path.join(__dirname, '../src/recordUserFlow/', userFlowJsonFile);

        const content = await fs.readFile(userFlowJsonFilePath, 'utf-8')
        const jsonObj = JSON.parse(content);
        const input_schema = jsonObj.input_schema;
        
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({input_schema}),
                },
            ],
        };
    });
    
    // 15. replay user-flow json file.
    server.tool("replayUserFlow", "replay user flow recorded by devTool in browser.Before call this tool, caller should get input schema via getInputSchemaOfUserFlow to correctly format params. ", {
        userFlowJsonFile: z.string().describe("The user flow json file. The file path is relative to src/recordUserFlow/}`"),
        inputData: z.record(z.any()).optional().describe("The input data in JSON format for the User Flow.")
    }, async ({ userFlowJsonFile,inputData={} }) => {
        logger.error(`inputData:${JSON.stringify(inputData)}`);
        const page = await agentContext.getCurrentPage();
        if (!page) {
            throw new Error('Page not found');
        }

        const taskId = randomUUID();
        playwrightTasks[taskId] = {
            status: 'pending'
            };
        
        replay(userFlowJsonFile,inputData,page,agentContext,taskId);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ taskId, message: '任务已启动，可通过 checkPlaywrightTaskStatus 工具查询状态' }),
                },
            ],
        };
    });

    // 16.saveLinkImage 工具
    server.tool("saveLinkImage", "save the images specied in selector on page", {
        selector: z.string().describe("the image element's selector in page"),
    }, async ({ selector }) => {
        const page = await agentContext.getCurrentPage();
        if (!page) {
            throw new Error('Page not found');
        }

        const element = await page.$(selector);
        if (!element) {
            throw new Error('Image element not found');
        }

        // 检查元素是否为 <img> 标签
        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
        if (tagName !== 'img') {
            throw new Error('The selected element is not an image element');
        }
        const imageUrl = await element.getAttribute('src');
        if (!imageUrl) {
            throw new Error('Image URL not found');
        }

        const imageUUID = randomUUID();
        const imagesDir = await AgentContext.getImagesDir();
        const imagePath = path.join(imagesDir, `${imageUUID}.png`);
        try {
            // 使用 page.request.fetch 直接下载图片
            const response = await page.request.fetch(imageUrl);
            if (!response.ok()) {
                throw new Error('Failed to fetch image');
            }
            const buffer = await response.body();
            await fs.writeFile(imagePath, buffer);
        }
        catch (error) {
            let errorMessage = 'An unknown error occurred';
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            throw new Error(`Failed to save image: ${errorMessage}`);
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ url: imageUrl, imagePath }),
                },
            ],
        };
    });

    // 异步函数，用于读取 HTML 模板文件
    async function readHtmlTemplate(fileName: string): Promise<string> {
        const resourcesPath = await AgentContext.getResourcesDir(); // 使用 await 等待异步操作
        const templatePath = path.join(resourcesPath, fileName);
        return fs.readFile(templatePath, 'utf-8');
    }
    
    //17. 在浏览器中展示本地文件
    server.tool(
        "showLocalFile",
        "Display a specified local file in a new page",
        {
            filePath: z.string().describe("The local file absoluate path to be shown in a new page"),
        },
        async ({ filePath }) => {
            try {
                // 检查文件是否存在
                await fs.access(filePath, fs.constants.F_OK);
    
                // 从环境变量获取视频扩展名，若未定义则使用默认值
                const videoExtensions = process.env.LOCAL_FILE_VIDEO_EXTENSION 
                    ? process.env.LOCAL_FILE_VIDEO_EXTENSION.split(',').map(ext => `.${ext.trim().toLowerCase()}`) 
                    : ['.mp4', '.mov', '.avi', '.mkv'];
    
                // 从环境变量获取音频扩展名，若未定义则使用默认值
                const audioExtensions = process.env.LOCAL_FILE_AUDIO_EXTENSION 
                    ? process.env.LOCAL_FILE_AUDIO_EXTENSION.split(',').map(ext => `.${ext.trim().toLowerCase()}`) 
                    : ['.mp3', '.wav', '.ogg'];
    
                let url: string;
                const ext = path.extname(filePath).toLowerCase();
    
                if (videoExtensions.includes(ext) || audioExtensions.includes(ext)) {
                    // 读取 HTML 模板文件
                    let htmlContent = await readHtmlTemplate(videoExtensions.includes(ext) ? 'video_template.html' : 'audio_template.html');
                    // 替换模板中的占位符
                    htmlContent = htmlContent.replace('{{filePath}}', filePath).replace('{{fileType}}', ext.slice(1));
    
                    const tempHtmlPath = path.join(await AgentContext.getTempDir(), `${randomUUID()}.html`);
                    await fs.writeFile(tempHtmlPath, htmlContent);
                    url = `file:///${tempHtmlPath.replace(/\\/g, '/')}`;
                } else {
                    // 其他文件直接使用 file:/// 协议
                    url = `file:///${filePath.replace(/\\/g, '/')}`;
                }
    
                const page = await agentContext.getCurrentPage();
                await page.goto(url);                
    
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ pageUrl: url }),
                        },
                    ],
                };
            } catch (error) {
                if (error instanceof Error) {
                    logger.error('Error in showLocalFile:', error.message);
                    throw new Error(`Failed to show local file: ${error.message}`);
                }
                logger.error('Unknown error in showLocalFile:', error);
                throw new Error('Failed to show local file due to an unknown error');
            }
        }
    );
    // 暴露图片资源作为一个整体
    // server.resource(
    //   "images",
    //   "All captured images",
    //   async (uri) => {
    //     // 解析查询参数获取 imageUUID
    //     const url = new URL(uri.href);
    //     const imageUUID = url.searchParams.get("imageUUID");
    //     if (!imageUUID) {
    //       throw new Error("imageUUID parameter is required");
    //     }
    //     const imagePath = agentContext.getImagePath(imageUUID);
    //     if (!imagePath) {
    //       throw new Error("Image not found");
    //     }
    //     try {
    //       const buffer = await fs.readFile(imagePath);
    //       const base64Image = buffer.toString('base64');
    //       return {
    //         contents: [
    //           {
    //             uri: uri.href,
    //             text: `data:image/png;base64,${base64Image}`
    //           }
    //         ]
    //       };
    //     } catch (error) {
    //       logger.error('Failed to read image file:', error);
    //       throw new Error('Failed to get image resource');
    //     }
    //   }
    // );
    return { server, browserAgent };
}