import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');


export { projectRoot };

interface AgentInterface {
  // before connect to a page, you should call this method to set up the agent.
  // to connect to a remote browser, a port needs to be provided.
  setUp():Promise<void>;

  // before close the Agenet, you should call this method to tear down the agent.
  tearDown():Promise<void>;

  getContext(): BrowserContext | null;
  getBrowser(): Browser | null;
  getNewPage(): Promise<Page>;
}

class remoteAgent implements AgentInterface {
    protected hostUrl: string;
    protected port: number;
    protected browser: Browser | null = null;
    protected context: BrowserContext | null = null;

    constructor(hostUrl: string, port: number) {
        this.hostUrl = hostUrl;
        this.port = port;
    }
    
    getContextStorageFilePath(): string {
        const filePath:string = process.env.REMOTE_STORAGE_FILE_PATH??resolve(projectRoot,"remote_state.json");
        return filePath; 
    }

    getContext(): BrowserContext | null {
        return this.context; 
    }
    getBrowser(): Browser | null {
        return this.browser; 
    }

    getNewPage(): Promise<Page> {
        return this.context?.newPage() || Promise.reject(new Error('Context is not initialized'));
    }

    async setUp(): Promise<void> {
        try {
            // 1. 先确保 Chrome 已以调试模式启动
            logger.info(`尝试连接到Chrome调试实例:${this.hostUrl}:${this.port}`);
            
            // 2. 连接到Chrome实例,如http://localhost:9222
            // Chromse should stared with the following command:
            // chrome.exe --remote-debugging-port=9222 --user-data-dir="J:\mcpservers\contextBrowserServer\chrome_debug"
            this.browser = await chromium.connectOverCDP(`${this.hostUrl}:${this.port}`);            
            
            // 3. 获取第一个上下文
            this.context = this.browser.contexts()[0];

            logger.info('✅ 成功连接到 Chrome 实例');
          } catch (error) {
            logger.error('❌ 连接失败:', error);
            logger.info(`请确保已按以下方式启动 Chrome:\n   ${process.env.REMOTE_BROWSER_FILE_PATH} \n      --remote-debugging-port=9223\n      --user-data-dir="J:/mcpservers/contextBrowserServer/chrome_debug\n`);
            //logger.info(`${process.env.REMOTE_BROWSER_FILE_PATH} --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\\Google\\Chrome\\User Data"`);
            logger.info('如果仍有问题，尝试更换端口号,如:9223');
            throw new Error('无法连接到 Chrome 实例');
          }
    }

    async tearDown(): Promise<void> {
        if(this.context){
            const filePath:string = this.getContextStorageFilePath();
            await this.context.storageState({ path:filePath});
            logger.info(`上下文文件为:${filePath}`);

            //await this.context.close(); // 关闭上下文
            this.context = null;
        }
        if (this.browser) {
          //await this.browser.close(); // 关闭浏览器
          this.browser = null;
          logger.info('已断开与Chrome实例的逻辑连接');
        }
    } 
}

export { AgentInterface,remoteAgent };