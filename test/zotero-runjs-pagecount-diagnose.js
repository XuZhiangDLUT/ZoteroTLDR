// Zotero Developer Tools > Run JavaScript
// 用途：诊断“页数获取”在你的 PDF 上为何失败
// 方法：pdf.js(正确字节 Uint8Array + 超时) + Header /Count + 查询 Zotero DB 的 page 相关列
//
// 使用：
// 1) 在 Zotero 中选中一些条目或 PDF 附件（包含你认为“页数拿不到”的 PDF）
// 2) Tools > Developer > Run JavaScript
// 3) 复制本文件全部内容并运行
// 4) 打开 Tools > Developer > Error Console 查看 console.table 输出

(async () => {
  const pane = Zotero.getActiveZoteroPane();
  const selectedItems = pane.getSelectedItems();
  if (!selectedItems.length) {
    alert("请先选择条目或 PDF 附件再运行脚本");
    return;
  }

  // 让你输入 maxPageCount，用来模拟插件中的页数限制逻辑
  const input = prompt(
    "请输入测试用的 maxPageCount（页数上限，0 表示不限制）",
    "50",
  );
  const MAX_PAGE_COUNT = parseInt(input, 10);
  if (isNaN(MAX_PAGE_COUNT) || MAX_PAGE_COUNT < 0) {
    alert("maxPageCount 输入无效");
    return;
  }

  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(label + " 超时")), ms),
      ),
    ]);

  // Zotero.File.getBinaryContentsAsync(filePath) 返回“二进制字符串”
  // pdf.js 更稳妥的输入是 Uint8Array
  const binaryStringToUint8Array = (binStr) => {
    const len = binStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i) & 0xff;
    return bytes;
  };

  async function getPagesViaPdfJs(filePath) {
    const pdfjsLib = Zotero.PDFWorker && Zotero.PDFWorker.pdfjsLib;
    if (!pdfjsLib) return { pages: null, ok: false, error: "pdfjsLib 不可用" };

    try {
      const bin = await Zotero.File.getBinaryContentsAsync(filePath);
      const data = binaryStringToUint8Array(bin);

      const loadingTask = pdfjsLib.getDocument({
        data,
        stopAtErrors: false,
        enableXfa: false,
      });

      const pdf = await withTimeout(
        loadingTask.promise,
        10000,
        "pdf.js getDocument",
      );
      const pages = pdf.numPages;
      pdf.destroy();
      return { pages, ok: typeof pages === "number", error: null };
    } catch (e) {
      return { pages: null, ok: false, error: e?.message || String(e) };
    }
  }

  async function getPagesViaHeader(filePath) {
    try {
      const content = await Zotero.File.getBinaryContentsAsync(filePath);
      const matches = content.match(/\/Count\s+(\d+)/g);
      if (!matches || !matches.length)
        return { pages: null, ok: false, error: "未匹配到 /Count N" };

      let maxCount = 0;
      for (const m of matches) {
        const n = parseInt(m.replace(/\/Count\s+/, ""), 10);
        if (Number.isFinite(n) && n > maxCount) maxCount = n;
      }
      return maxCount > 0
        ? { pages: maxCount, ok: true, error: null }
        : { pages: null, ok: false, error: "匹配到 /Count 但无法取到有效数字" };
    } catch (e) {
      return { pages: null, ok: false, error: e?.message || String(e) };
    }
  }

  async function dbQuery(sql, params) {
    if (Zotero.DB && typeof Zotero.DB.queryAsync === "function")
      return Zotero.DB.queryAsync(sql, params);
    if (Zotero.DB && typeof Zotero.DB.query === "function")
      return Zotero.DB.query(sql, params);
    throw new Error("Zotero.DB.queryAsync/query 不可用");
  }

  async function getPageCols(tableName) {
    try {
      const info = await dbQuery(`PRAGMA table_info(${tableName})`);
      const cols = info.map((r) => r.name).filter(Boolean);
      return cols.filter((c) => String(c).toLowerCase().includes("page"));
    } catch (_e) {
      return [];
    }
  }

  async function getPageColsRow(tableName, itemID, pageCols) {
    if (!pageCols.length) return null;
    const cols = ["itemID"].concat(pageCols);
    const rows = await dbQuery(
      `SELECT ${cols.join(", ")} FROM ${tableName} WHERE itemID = ?`,
      [itemID],
    );
    if (!rows || !rows.length) return null;

    const row = rows[0];
    const obj = {};
    for (const c of cols) obj[c] = row[c];
    return obj;
  }

  const fulltextPageCols = await getPageCols("fulltextItems");
  const attachPageCols = await getPageCols("itemAttachments");

  // 收集 PDF 附件
  const pdfAttachments = [];
  for (const item of selectedItems) {
    let attachments = [];
    if (item.isAttachment && item.isAttachment()) {
      attachments.push(item);
    } else if (item.isRegularItem && item.isRegularItem()) {
      const attIds = item.getAttachments ? item.getAttachments() : [];
      for (const attId of attIds) {
        const att = Zotero.Items.get(attId);
        if (att) attachments.push(att);
      }
    }

    for (const att of attachments) {
      const contentType =
        att.attachmentContentType ||
        (att.getField && att.getField("contentType")) ||
        "";
      if (!String(contentType).includes("application/pdf")) continue;

      const getFilePath =
        att.getFilePath || (att._getFilePath && att._getFilePath.bind(att));
      const filePath = getFilePath ? getFilePath.call(att) : "";
      if (!filePath) continue;

      const fileName = filePath.split(/[/\\]/).pop() || "(未命名)";
      pdfAttachments.push({ attachment: att, filePath, fileName });
    }
  }

  if (!pdfAttachments.length) {
    alert("在选中的条目/附件中未找到任何 PDF");
    return;
  }

  const results = [];

  const toPositiveInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };

  for (const { attachment, filePath, fileName } of pdfAttachments) {
    const id = attachment.id;

    const pdfjs = await getPagesViaPdfJs(filePath);
    const header = await getPagesViaHeader(filePath);

    let ftRow = null;
    let iaRow = null;
    try {
      ftRow = await getPageColsRow("fulltextItems", id, fulltextPageCols);
    } catch (_e) {}
    try {
      iaRow = await getPageColsRow("itemAttachments", id, attachPageCols);
    } catch (_e) {}

    const ftStr = ftRow
      ? Object.entries(ftRow)
          .filter(([k]) => k !== "itemID")
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      : "";
    const iaStr = iaRow
      ? Object.entries(iaRow)
          .filter(([k]) => k !== "itemID")
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      : "";

    const dbTotalPages = toPositiveInt(ftRow && ftRow.totalPages);
    const dbIndexedPages = toPositiveInt(ftRow && ftRow.indexedPages);
    const dbPages = dbTotalPages ?? dbIndexedPages;

    // 选择页数来源（优先 Zotero DB，其次 pdf.js，最后 Header）
    let chosenPages = null;
    let chosenMethod = "none";
    if (dbTotalPages !== null) {
      chosenPages = dbTotalPages;
      chosenMethod = "DB fulltextItems.totalPages";
    } else if (dbIndexedPages !== null) {
      chosenPages = dbIndexedPages;
      chosenMethod = "DB fulltextItems.indexedPages";
    } else if (typeof pdfjs.pages === "number") {
      chosenPages = pdfjs.pages;
      chosenMethod = "pdfjsLib";
    } else if (typeof header.pages === "number") {
      chosenPages = header.pages;
      chosenMethod = "PDF Header /Count";
    }

    let decision = "通过";
    let reason = "未设置页数限制 (maxPageCount = 0)";
    if (MAX_PAGE_COUNT > 0) {
      if (chosenPages === null) {
        decision = "跳过";
        reason = `无法获取页数 (已设置页数限制 ${MAX_PAGE_COUNT} 页)`;
      } else if (chosenPages > MAX_PAGE_COUNT) {
        decision = "跳过";
        reason = `页数过多 (${chosenPages} 页 > ${MAX_PAGE_COUNT} 页)`;
      } else {
        decision = "通过";
        reason = "页数在限制范围内";
      }
    }

    results.push({
      fileName,
      itemID: id,
      pdfjsPages: pdfjs.pages,
      pdfjsError: pdfjs.error || "",
      headerPages: header.pages,
      headerError: header.error || "",
      fulltextItemsPageCols: fulltextPageCols.join(","),
      fulltextItemsPageVals: ftStr,
      itemAttachmentsPageCols: attachPageCols.join(","),
      itemAttachmentsPageVals: iaStr,
      dbTotalPages,
      dbIndexedPages,
      dbPages,
      chosenPages,
      chosenMethod,
      decision,
      reason,
    });
  }

  console.log("=== 页数诊断结果 ===");
  console.table(results);

  alert(
    "完成：请打开 Tools > Developer > Error Console 查看 console.table（把无法获取页数的那几行贴给我）",
  );
  return results;
})();
