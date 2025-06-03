# MongoDB 安装与配置指南

本指南将介绍在 Windows 和 Linux（以 Ubuntu 为例）系统上安装、启动 MongoDB 并进行基础配置的步骤，以便让相关程序能够正常使用 MongoDB 存储数据。

## 一、Windows 系统安装与配置

### 1. 下载安装包
访问 [MongoDB 官方下载页面](https://www.mongodb.com/try/download/community)，选择适合你 Windows 系统版本的 MongoDB Community Server 安装包进行下载。

### 2. 运行安装程序
双击下载的 `.msi` 文件，按照安装向导的提示进行安装。在安装过程中，你可以选择自定义安装路径，同时建议勾选 “Install MongoDB Compass”（可选的图形化管理工具）。

### 3. 配置环境变量
将 MongoDB 的 `bin` 目录（默认路径为 `C:\Program Files\MongoDB\Server\{version}\bin`，`{version}` 是你安装的 MongoDB 版本号）添加到系统的 `PATH` 环境变量中，具体步骤如下：
1. 右键点击“此电脑”，选择“属性”。
2. 点击“高级系统设置”。
3. 在“系统属性”窗口中，点击“环境变量”。
4. 在“系统变量”列表中找到“Path”变量，点击“编辑”。
5. 点击“新建”，添加 MongoDB 的 `bin` 目录路径，然后依次点击“确定”保存设置。

### 4. 启动 MongoDB
安装完成后，MongoDB 会作为 Windows 服务自动启动。你也可以通过以下步骤手动启动：
1. 打开“服务”应用程序（可以通过在开始菜单中搜索“服务”找到）。
2. 找到“MongoDB Server ({version})”服务，右键点击并选择“启动”。

## 二、Linux 系统（以 Ubuntu 为例）安装与配置
### 1. 安装程序
1. 导入 MongoDB 公共 GPG 密钥：
  ```bash
  wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
  ```
2. 创建源列表文件：
  ```bash
  echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
  ```
3. 刷新本地包数据库：
  ```bash
  sudo apt-get update
  ```
4. 安装 MongoDB：
  ```bash
  sudo apt-get install -y mongodb-org
  ```
### 2. 启动MongoDB
1. 使用以下命令启动 MongoDB 服务：
  ```bash
  sudo systemctl start mongod
  ```
2. 检查 MongoDB 服务是否正在运行：
  ```bash
  sudo systemctl status mongod
  ```
3. 确保 MongoDB 服务在系统启动时自动启动：
  ```bash
  sudo systemctl enable mongod
  ```
### 3. 配置环境变量
1. 编辑 `~/.bashrc` 文件：
  ```bash
  nano ~/.bashrc
  ```
2. 在文件末尾添加以下行：
  ```bash
  export PATH="/usr/local/mongodb/bin:$PATH"
  MONGO_URL=mongodb://localhost:27017
  MONGO_DB_NAME=playwrightTasksDB
  ```
3. 保存并退出文件。
### 4. 验证 MongoDB 是否正常工作
使用 MongoDB 命令行客户端 mongo 来验证 MongoDB 是否正常工作：
  ```bash
  mongosh
  ```
  如果成功连接到 MongoDB 服务器，你将看到类似以下的输出：
  ```plaintext
    Current Mongosh Log ID: ...
    Connecting to:          mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+2.0.2
    Using MongoDB:          7.0.4
    Using Mongosh:          2.0.2

    For mongosh info see: https://docs.mongodb.com/mongodb-shell/

    ------
    The server generated these startup warnings when booting
    2024-04-23T10:00:00.000+08:00: Using the XFS filesystem is strongly recommended with the WiredTiger storage engine. See http://dochub.mongodb.org/core/prodnotes-filesystem
    ------

    test> 
  ```
在 test> 提示符下输入 show dbs 命令，如果能正常显示数据库列表，说明 MongoDB 已经成功启动并可以正常使用。
