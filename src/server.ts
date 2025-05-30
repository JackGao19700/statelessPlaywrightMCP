
import { build } from 'esbuild';
import vm from 'vm';

import { Page } from 'playwright';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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


const Extern_Script_Path=process.env.EXTERN_SCRIPT_PATH??path.resolve(__dirname,"src/externScripts/");


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
        const page = await browserAgent.getNewPage();
        await page.goto(url);
        agentContext.setCurrentPage(page);
        const pageID = agentContext.getPageID(page);
        return {
            content: [
                {
                    type: "text",
                    // 将 JSON 对象转换为字符串,返回.
                    text: JSON.stringify({ pageID, pageUrl: url }),
                },
            ],
        };
    });
    // 2. snapshot a elemnt or the whole page.
    server.tool(
        "snapshot",
        "Take a screenshot of a page or an element",
        {
            pageID: z.number().int().nonnegative().optional().describe("The index of the page to take a screenshot. If ignored or 0, use the current page."),
            selector: z.string().describe("The selector for the element to screenshot. If null, screenshot the whole page."),
            width: z.number().optional().describe("The width of the screenshot. If null, use the element's width or viewport width."),
            height: z.number().optional().describe("The height of the screenshot. If null, use the element's height or viewport height."),
            offsetX: z.number().optional().describe("The horizontal offset from the top-left corner of the element or page. If null, default to 0."),
            offsetY: z.number().optional().describe("The vertical offset from the top-left corner of the element or page. If null, default to 0."),
        },
        async ({ pageID = 0, selector,width, height, offsetX = 0, offsetY = 0 }) => {
            const page = agentContext.getPage(pageID);
            if (!page) {
                throw new Error('Page not found');
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
            let pageIndex: number = 1;
            for (const browserPage of browserPages) {
                // 移除不必要的 await
                const url = browserPage.url(); 
                pagesInfo.push({ url, pageIndex });
                pageIndex++;
            }
            let currentPageID: number | null = null;
            const currentPage = agentContext.getCurrentPage();
            if (currentPage) {
                currentPageID = agentContext.getPageID(currentPage);
            }
    
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ pagesInfo, currentPageID }),
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
            pageID: z.number().int().nonnegative().optional().describe("The index of the page where the element is located. If ignored or 0, use the current page."),
            selector: z.string().describe("CSS selector for the element to click")
        },
        async ({ pageID = 0, selector }) => {
            const timeOutMSeconds: number = Number(process.env.TIMEOUT_MSECOND_FOR_NEW_PAGE) || 2000;
    
            const page = agentContext.getPage(pageID);
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
                // 移除不必要的 await
                const newPageUrl = newPage.url(); 
                const newPageID = agentContext.getPageID(newPage);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ message: "A new page is generated after clicking", newPage: { pageID: newPageID, pageUrl: newPageUrl } }),
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
        pageID: z.number().int().nonnegative().optional().describe("The index of the page where the input field is located. If ignored or 0, use the current page."),
        selector: z.string().describe("CSS selector for input field"),
        value: z.string().describe("Value to fill"),
    }, async ({ pageID = 0, selector, value }) => {
        const page = agentContext.getPage(pageID);
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
        pageID: z.number().int().nonnegative().optional().describe("The index of the page where the select element is located. If ignored or 0, use the current page."),
        selector: z.string().describe("CSS selector for element to select"),
        value: z.string().describe("Value to select"),
    }, async ({ pageID = 0, selector, value }) => {
        const page = agentContext.getPage(pageID);
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
        pageID: z.number().int().nonnegative().optional().describe("The index of the page where the element is located. If ignored or 0, use the current page."),
        selector: z.string().describe("CSS selector for element to hover"),
    }, async ({ pageID = 0, selector }) => {
        const page = agentContext.getPage(pageID);
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
        pageID: z.number().int().nonnegative().optional().describe("The index of the page to execute the JavaScript code. If ignored or 0, use the current page."),
        script: z.string().describe("JavaScript code to execute"),
    }, async ({ pageID = 0, script }) => {
        const page = agentContext.getPage(pageID);
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
    // 9. closePage 工具
    server.tool("closePage", "Close the page and release related resources.If close the current page, the current page will be null.", {
        pageID: z.number().int().nonnegative().optional().describe("The index of page to close"),
    }, async ({ pageID = 0 }) => {
        const sucessClose = await agentContext.removePage(pageID);
        if (!sucessClose) {
            throw new Error('Page not found');
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ message: "Page closed successfully" }),
                },
            ],
        };
    });
    // 10. getTexts 工具
    server.tool("getTexts", "get all human readable texts of elements on page", {
        pageID: z.number().int().nonnegative().optional().describe("The index of page from which to retrieve texts. If ignored or 0, use the current page."),
        selector: z.string().describe("CSS selector for the element to get texts"),
    }, async ({ pageID = 0, selector }) => {
        const page = agentContext.getPage(pageID);
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
    // 11. getHTML 工具
    server.tool("getHTML", "Get the HTML content specified by selector. If selector is null, return whole html of the page", {
        pageID: z.number().int().nonnegative().optional().describe("The index of page from which to to retrieve HTML. If ignored or 0, use the current page."),
        selector: z.string().optional().describe("CSS selector for the element to get HTML texts. Or HTML text of the page if null.")
    }, async ({ pageID = 0, selector }) => {
        const page = agentContext.getPage(pageID);
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
    // 12. focusPage 工具
    server.tool("focusPage", "set the specified page as the current page and let it to be visible in the browser", {
        pageID: z.number().int().positive().describe("The index of page to focus and set as the current page."),
    }, async ({ pageID }) => {
        const page = agentContext.getPage(pageID);
        if (!page) {
            throw new Error('Page not found');
        }
        await page.bringToFront();
        agentContext.setCurrentPage(page);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ message: "Set the page as current page and focused it successfully" }),
                },
            ],
        };
    });

    // 14.run playwright code
      server.tool("runPlaywrightWebCode", "run playwright web auto code stored in a .ts file. The .ts code must follow externScripts/scriptTemplate.ts.", {
        scriptFile: z.string().describe(`The .ts file of playwright web auto code script file. The file path is relative to ${Extern_Script_Path}`)
    }, async ({ scriptFile }) => {
        try{
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
        
            // 调用 run 并传入参数
            const jsonString = await scriptTS.run({
                browser:browserAgent.getBrowser(),
                context:browserAgent.getContext(),
                page:agentContext.getCurrentPage(),
                customData: { userId: 123 }, // 可选自定义参数
            });
        
            // 解析 JSON
            const result = JSON.parse(jsonString);
            console.error('脚本执行结果:', result);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ isCodeRun:true, codeRunResult:result}),
                    },
                ],
            };    
          } catch (error) {
            console.error('执行脚本失败:', error);
            throw error;
          }
    });
  
    // 14.B run playwright code
    server.tool("runPlaywrightWebCodeJIT", "run playwright web auto code stored in a .ts file. The .ts code must follow externScripts/scriptTemplate.ts.", {
        scriptFile: z.string().describe(`The .ts file of playwright web auto code script file. The file path is relative to ${Extern_Script_Path}`)
    }, async ({ scriptFile }) => {
        try {
            const scriptFilePath = path.join(Extern_Script_Path, scriptFile);
    
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
      

    // 14.saveLinkImage 工具
    server.tool("saveLinkImage", "save the images specied in selector on page", {
        pageID: z.number().int().nonnegative().optional().describe("The index of page from which to fetch images for saving. If ignored or 0, use the current page."),
        selector: z.string().describe("the image element's selector in page"),
    }, async ({ pageID = 0, selector }) => {
        const page = agentContext.getPage(pageID);
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
            const response = await page.goto(imageUrl);
            if (!response || !response.ok()) {
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
    //15. 在浏览器中展示本地文件
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
    
                const page = await browserAgent.getNewPage();        
                await page.goto(url);
                const pageID = agentContext.getPageID(page);
    
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ pageID, pageUrl: url }),
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