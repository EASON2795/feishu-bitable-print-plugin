# Chrome 扩展使用说明

## 适用范围

Chrome 版可以接收飞书多维表格插件读取到的当前勾选记录及关联明细，也可以导入 CSV、TSV 或 JSON。在本机完成模板选择、A4 预览、打印和“另存为 PDF”，不需要业务服务器。

登录飞书本身不会把数据授权给 Chrome。同步时必须同时打开本项目的飞书多维表格插件：飞书插件使用官方 Base SDK 取数，Chrome 只接收已经整理好的单据快照。

## 安装

### 使用现成的试用包

1. 解压 `单据排版打印台-Chrome试用版-v0.4.0-安装包.zip`。
2. 在 Chrome 地址栏打开 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的 `单据排版打印台-Chrome试用版-v0.4.0` 文件夹。
6. 在浏览器工具栏的扩展菜单中，将“单据排版打印台”固定。
7. 点击扩展图标，排版工作台会在 Chrome 右侧面板中打开；再次点击可收起。

右侧面板的左边缘可以左右拖动。面板较窄时模板栏会自动收起，拖宽到足够宽时会自动恢复；也可以用“显示模板”和“隐藏模板”手动切换。Chrome 允许用户在浏览器设置中统一把所有侧边面板改到左侧，本扩展会服从这项全局设置。

### 从源代码构建

需要 Node.js 20 或更高版本：

```bash
npm ci
npm run build:chrome
```

然后在 `chrome://extensions/` 中加载项目生成的 `dist-chrome/` 文件夹。

## 从飞书读取勾选记录

1. 在飞书多维表格中添加“单据排版打印台”自定义插件，服务地址填写：`https://eason2795.github.io/feishu-bitable-print-plugin/`。
2. 打开该飞书插件，并在插件模板里绑定当前 Base 的主表、明细表和字段。
3. 在飞书表格中勾选要打印的记录；插件会自动识别复选框变化，并用官方 SDK 读取主记录、关联明细和当前排版模板。
4. 飞书插件状态栏出现“Chrome 已同步”后，点击 Chrome 工具栏里的“单据排版打印台”，在右侧面板查看排版结果。
5. Chrome 工作台应显示“飞书数据”和正确的单据数量；也可以点击“同步飞书”重新载入。
6. 检查预览后点击“打印”或“另存 PDF”。

飞书插件面板必须打开，只有登录飞书还不够。Chrome 不会抓取飞书页面画布，也不会读取登录 Cookie。

## 从本地文件导入

1. 点击“导入数据”。
2. 选择 CSV、TSV 或 JSON 文件。
3. 在左侧选择形式发票、商业发票或装箱单模板。
4. 检查 A4 预览。
5. 点击“打印”或“另存 PDF”。
6. 在 Chrome 打印窗口中选择打印机，或选择“另存为 PDF”。

“载入虚构示例”可随时恢复内置演示数据。导入的客户和单据数据只保留在当前页面；刷新或关闭后会清除。自定义模板会保存在 Chrome 本机。

## CSV / TSV 格式

一行表示一条商品明细；相同 `invoiceNo` 的行会合并为同一张单据。示例：

```csv
invoiceNo,invoiceDate,customerInvoiceTitle,totalWithCurrency,sortNo,itemName,specification,quantity,unit,unitPrice,subtotal
PI-001,2026/08/06,DEMO CUSTOMER,$100.00,1,PRODUCT A,SAMPLE,1,PCS,$100.00,$100.00
```

支持常用中英文字段名，例如：

- 单据号：`invoiceNo`、`订单号`、`发票号`、`PI号`
- 日期：`invoiceDate`、`日期`、`发票日期`
- 客户：`customerInvoiceTitle`、`客户抬头`、`买方`
- 商品：`itemName`、`品名`、`产品名称`
- 数量：`quantity`、`qty`、`数量`
- 单价：`unitPrice`、`price`、`单价`
- 小计：`subtotal`、`lineTotal`、`小计`

完整示例在扩展包的 `examples/sample-documents.csv`。

## JSON 格式

```json
{
  "documents": [
    {
      "invoiceNo": "PI-001",
      "invoiceDate": "2026/08/06",
      "customerInvoiceTitle": "DEMO CUSTOMER",
      "totalWithCurrency": "$100.00",
      "items": [
        {
          "sortNo": "1",
          "itemName": "PRODUCT A",
          "quantity": "1",
          "unit": "PCS",
          "unitPrice": "$100.00",
          "subtotal": "$100.00"
        }
      ]
    }
  ]
}
```

完整示例在扩展包的 `examples/sample-documents.json`。

## 更新与卸载

- 更新源码后重新执行 `npm run build:chrome`，再到扩展管理页点击该扩展的“重新加载”。
- 卸载扩展会同时删除扩展本地保存的自定义模板。
- 试用版尚未提交 Chrome 应用商店，因此开发者模式下 Chrome 可能提示这是未打包扩展。

## 隐私与权限

- 不需要服务器。
- 申请 Chrome 的 `sidePanel` 权限，只用于在浏览器原生侧边面板中显示工作台。
- 只允许在本项目精确的 GitHub Pages 插件地址中运行同步桥接，不申请读取整个飞书网站。
- 使用 Chrome 会话存储暂存最后一次飞书同步快照，关闭浏览器后清除。
- 不申请读取飞书 Cookie、浏览历史、下载记录或剪贴板权限。
- 导入数据不上传到项目开发者的服务器。
- 打印和 PDF 保存由 Chrome 与操作系统完成。
