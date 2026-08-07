# 单据排版打印台

开源的单据排版与打印工具，同时提供飞书/Lark 多维表格版和 Chrome 本地版。它在浏览器内生成 A4 单据预览，并调用系统打印窗口完成打印或“另存为 PDF”。

> 隐私优先：社区版没有接收单据内容的后端服务。客户、金额、银行和产品明细不会发送给本项目维护者。

## 功能

- 读取多维表格当前记录或批量选择的记录
- Chrome 版可接收飞书插件读取的勾选记录，也支持导入本地 CSV、TSV 和 JSON
- 展开主记录关联的明细记录
- 内置形式发票、商业发票和装箱单入口
- 支持公司信息、标题、表头、条款、列宽、字号和页边距调整
- 支持导入飞书导出的模板文件并绑定字段
- 自定义模板保存在当前浏览器
- 使用浏览器本地打印；可在系统打印窗口中选择“另存为 PDF”
- 开发模式提供完全虚构的演示数据

## Chrome 版

Chrome 版不需要业务服务器，也不读取飞书登录 Cookie。完整同步模式由飞书插件使用官方 Base SDK 读取当前勾选记录及关联明细，再通过精确匹配的公开插件页面交给 Chrome 打印台；GitHub Pages 只提供静态页面，不接收或保存单据正文。

如果不使用飞书同步，也可以继续导入 CSV、TSV 或 JSON。安装后点击扩展图标，完整排版工作台会在 Chrome 右侧面板中打开；拖动面板左边缘即可调整宽度，窄宽和宽屏布局会自动切换。

### 安装试用版

1. 运行 `npm run build:chrome`，生成 `dist-chrome/`。
2. 在 Chrome 地址栏打开 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择项目里的 `dist-chrome/` 文件夹。
5. 将“单据排版打印台”固定到工具栏，点击图标即可在右侧面板中使用。

要读取飞书勾选数据，还需按“在飞书多维表格中使用”一节添加同名飞书插件，并保持插件面板打开。飞书插件读取成功后，Chrome 工作台会显示“飞书数据”。

详细说明与数据格式见 [Chrome 扩展使用说明](docs/CHROME_EXTENSION.md)。

## 在线地址

- 插件页面：<https://eason2795.github.io/feishu-bitable-print-plugin/>
- 演示模式：<https://eason2795.github.io/feishu-bitable-print-plugin/?demo=1>

在线地址会在仓库首次发布并启用 GitHub Pages 后生效。

## 在飞书多维表格中使用

1. 打开一个多维表格。
2. 进入“多维表格插件”→“自定义插件”→“新增插件”。
3. 名称填写“单据排版打印台”。
4. 服务地址填写上面的 HTTPS 插件页面地址。
5. 打开插件，根据当前 Base 的表名和字段名复制或编辑模板映射。
6. 选择记录后点击“打印”或“另存 PDF”。

自定义插件默认只对创建者可用。提交飞书多维表格插件市场，需要在插件菜单中选择“发布”，填写飞书提供的信息收集表并等待团队评估。

## 数据表配置

内置演示模板使用下面的示例名称，实际使用时可在模板编辑器中改成自己的表和字段：

- 主表：`单据打印主表`
- 明细表：`单据明细表`
- 关联字段：`订单选择`

常用主字段包括订单号、日期、客户抬头、总计、金额大写、付款条款、贸易条款、港口和银行信息；常用明细字段包括品名、规格、数量、单位、单价和小计。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm ci
npm run dev:host
```

浏览器打开 `http://localhost:5173/?demo=1` 可查看虚构演示数据。生产环境不会在飞书读取失败后自动套用演示数据，避免误打印。

提交前运行：

```bash
npm run lint
npm run build
npm run build:chrome
```

## 部署

### GitHub Pages

仓库自带 Pages 工作流。将代码推送到 `main` 后，在仓库 Settings → Pages 中把 Source 设为 GitHub Actions，即可自动构建并发布 `dist/`。

### 静态服务器或 NAS

```bash
docker compose up -d --build
```

默认访问 `http://设备地址:18087/`。正式填入飞书时应使用可公开访问的 HTTPS 地址。

也可以直接执行 `npm run build`，把 `dist/` 部署到任意静态托管服务。Vite 已配置相对资源路径，支持子目录部署。

## 隐私与安全

- [隐私政策](PRIVACY.md)
- [使用条款](TERMS.md)
- [安全政策](SECURITY.md)
- [参与贡献](CONTRIBUTING.md)

不要把真实客户、银行账户、SWIFT、印章、手机号、邮箱、访问令牌或公司内部路径提交到公开仓库。导入模板和外部图片时，只使用可信且有权使用的文件与 HTTPS 地址。

## 技术结构

- React + TypeScript + Vite
- 飞书 Base JS SDK
- Chrome Manifest V3 + 原生 Side Panel；扩展构建不包含飞书 SDK
- 浏览器原生打印与“另存为 PDF”
- localStorage 保存自定义模板
- GitHub Actions 自动验证与部署

关键文件：

- `src/feishu.ts`：读取当前 Base、记录和字段结构
- `src/dataImport.ts`：Chrome 本地版 CSV/JSON 数据导入
- `src/chromeHost.ts`：Chrome 运行环境与飞书同步数据适配
- `src/bridgeProtocol.ts`：飞书插件到 Chrome 的本地桥接协议
- `src/piConfig.ts`：内置模板与字段映射
- `src/printDocument.ts`：生成可打印 HTML
- `src/localPrint.ts`：打开本地打印窗口
- `src/templateStore.ts`：浏览器本地模板存取

## 许可证

[MIT](LICENSE)
