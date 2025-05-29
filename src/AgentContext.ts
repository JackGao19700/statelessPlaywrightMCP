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

  getCurrentPage(): Page|null {
    return this.currentPage; 
  }
  setCurrentPage(page: Page|null): void {
    this.currentPage = page;
  }
  // 根据 pageUUID 获取页面
  getPage(pageID: number): Page | null {
    //pageIndex 从1开始计数. 所以需要减1.
    if(pageID==0) {
      return this.currentPage; 
    }else if(pageID<0 || pageID>this.context.pages().length) {
      return null;    
    }else{
      return this.context.pages()[pageID-1];
    }
  }

  getPageID(page: Page): number {
    //pageIndex 从1开始计数.pageIndex为0时，表示当前页面.
    return this.context.pages().indexOf(page)+1; 
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

  // 新增方法，获取所有页面的 UUID 和页面实例
  getPages():Array<Page> {
    return this.context.pages();
  }

  async removePage(pageID: number): Promise<boolean> {
    const page = this.getPage(pageID);
    if (!page) {
      return false;
    }

    try {
      // 关闭页面以释放资源
      if (page === this.currentPage) {
        this.setCurrentPage(null);
      }
      await page.close();
      return true;
      
    } catch (error) {
      console.error(`Failed to close page with ID ${pageID}:`, error);
      return false;
    }
  }

}
