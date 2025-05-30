import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';


async function createDirIfNotExists(dirPath:string): Promise<string> {
    try {
        // 检查目录是否存在
        const stats = await fs.stat(dirPath);
        if (!stats.isDirectory()) {
            // 如果存在但不是目录，抛出错误
            throw new Error(`${dirPath} 存在但不是目录`);
        }
    } catch (error) {
        // 检查 error 是否为 NodeJS.ErrnoException 类型
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            // 目录不存在，创建目录
            try {
            await fs.mkdir(dirPath, { recursive: true });
            } catch (mkdirError) {
            console.error('Failed to create images directory:', mkdirError);
            throw mkdirError;
            }
        } else {
            // 其他错误，直接抛出
            console.error('Error checking images directory:', error);
            throw error;
        }
    }
    return dirPath;
}

export class AgentContext {
  protected context: BrowserContext;
  protected currentPage: Page|null;

  constructor(browserContext:BrowserContext) {
    this.context = browserContext;
    this.currentPage = null;
  }

  async getCurrentPage(): Promise<Page> {
    if(!this.currentPage) {
      const pages = this.context.pages();
      if (pages.length === 0){
        try {
          this.currentPage = await this.context.newPage();
        } catch (error) {
          throw new Error('Failed to create a new page in the browser context');
        }
      }
      else {
        this.currentPage = pages[0];
      }
    }
    return this.currentPage!; 
  }

  async setCurrentPage(page:Page): Promise<void> {
    for (const p of this.context.pages()) {
      if (p !== page) {
        await p.close();
      }
    }
    this.currentPage = page;
  }

  // 销毁所有资源
  async destroy(): Promise<void> {
    //Do nothing.
  }

  static async getTempDir(): Promise<string> {
    // 优先使用环境变量中的路径
    const tempDir = process.env.TEMP_DIR
      ? path.resolve(process.env.TEMP_DIR)
      : path.resolve(__dirname, '../temp'); 

    return await createDirIfNotExists(tempDir);
  }

  // 静态方法，用于获取图片目录路径
  static async getImagesDir(): Promise<string> {
    // 优先使用环境变量中的路径
    const imagesDir = process.env.IMAGES_STORAGE_PATH 
      ? path.resolve(process.env.IMAGES_STORAGE_PATH) 
      : path.resolve(__dirname, '../images');
    
    return await createDirIfNotExists(imagesDir);
  }

  static async getResourcesDir(): Promise<string> {
    // 优先使用环境变量中的路径
    const imagesDir = process.env.RESOURCES_PATH 
      ? path.resolve(process.env.RESOURCES_PATH) 
      : path.resolve(__dirname, '../resources');
    
    return await createDirIfNotExists(imagesDir);
  }  

  static async getExternalScriptsDir(): Promise<string> {
    // 优先使用环境变量中的路径
    const externScriptDir=process.env.EXTERN_SCRIPT_PATH
    ? path.resolve(process.env.EXTERN_SCRIPT_PATH)
    :path.resolve(__dirname,"src/externScripts/");

    return await createDirIfNotExists(externScriptDir);
  }
}
