import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "../hooks/useRequestJson";
import { noteIdForImport, parseImportFile } from "../utils/dataImportParser";

const previewFields = [
  ["note_id", "笔记ID"], ["标题", "标题"], ["博主", "作者"], ["笔记链接", "链接"],
  ["点赞数", "点赞"], ["收藏数", "收藏"], ["评论数", "评论"],
];

const templateHeaders = ["笔记ID", "笔记链接", "标题", "内容", "博主", "博主主页链接", "笔记类型", "图片", "点赞数", "收藏数", "评论数", "分享数", "发布时间", "博主-地区", "关键词"];

function downloadTemplate() {
  const example = ["", "https://www.xiaohongshu.com/explore/请替换为笔记ID", "示例标题", "示例正文", "示例作者", "", "图文", "", "0", "0", "0", "0", "2026-08-15", "", "手工导入"];
  const escapeCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = `\ufeff${templateHeaders.map(escapeCell).join(",")}\r\n${example.map(escapeCell).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "geo-xhs-原始数据导入模板.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function valueFor(row, key) {
  if (key === "note_id") return noteIdForImport(row);
  const aliases = {
    标题: ["标题", "source_title"], 博主: ["博主", "作者", "source_author"],
    笔记链接: ["笔记链接", "作品链接", "source_note_url", "note_url"],
    点赞数: ["点赞数", "source_like_count"], 收藏数: ["收藏数", "source_collected_count"],
    评论数: ["评论数", "source_comments_count"],
  };
  return aliases[key]?.map((name) => row[name]).find((value) => value !== undefined && String(value).trim() !== "") ?? "";
}

function batchStatus(batch) {
  if (Number(batch.failed) > 0) return ["danger", "部分失败"];
  if (Number(batch.running) > 0) return ["warn", "处理中"];
  if (Number(batch.pending) > 0) return ["warn", "排队中"];
  return ["ok", "已完成"];
}

export function DataImportView({ onRefresh }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  const validRows = useMemo(() => rows.filter((row) => noteIdForImport(row)), [rows]);
  const invalidCount = rows.length - validRows.length;

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const payload = await requestJson("/api/data-import");
      setBatches(payload.batches || []);
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    loadBatches().catch(() => {});
    const timer = setInterval(() => loadBatches().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [loadBatches]);

  async function selectFile(nextFile) {
    if (!nextFile) return;
    setFile(nextFile);
    setRows([]);
    setResult(null);
    setParseError("");
    try {
      const parsed = await parseImportFile(nextFile);
      if (parsed.length > 500) throw new Error("单次最多导入 500 条，请拆分文件");
      setRows(parsed);
    } catch (error) {
      setParseError(error.message || "文件解析失败");
    }
  }

  async function submit() {
    if (!validRows.length || invalidCount) return;
    setUploading(true);
    setParseError("");
    try {
      const payload = await requestJson("/api/data-import", { method: "POST", body: JSON.stringify({ rows: validRows }) });
      setResult(payload);
      setRows([]);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await loadBatches();
      onRefresh?.();
    } catch (error) {
      setParseError(error.message || "上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="data-import-view">
      <section className="import-header">
        <div>
          <span className="section-kicker">Raw Data Intake</span>
          <h2>原始数据导入</h2>
        </div>
        <div className="import-pipeline" aria-label="自动处理链路">
          <span className="active">原始数据</span><i />
          <span>详情补全</span><i />
          <span>图片分析</span><i />
          <span>内容资产</span><i />
          <span>向量入库</span>
        </div>
      </section>

      <section className="import-grid">
        <article className="panel import-source-panel">
          <div className="panel-title-row"><div><h3>上传文件</h3><p>下载模板填写后，可直接上传 CSV 或 Excel</p></div><button className="template-download" type="button" onClick={downloadTemplate}><Download size={16} />下载 CSV 模板</button></div>
          <button className="import-dropzone" type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files?.[0]); }}>
            <UploadCloud size={28} />
            <strong>{file?.name || "选择原始数据文件"}</strong>
            <span>{file ? `${rows.length} 条记录` : "或拖放文件到此处"}</span>
          </button>
          <input ref={inputRef} hidden type="file" accept=".xlsx,.csv,.json" onChange={(event) => selectFile(event.target.files?.[0])} />
          <div className="import-field-grid">
            {[["必须", "笔记ID / 笔记链接"], ["可选", "标题、内容、作者、图片"], ["可选", "点赞、收藏、评论、分享"], ["自动", "详情、LLM、图片和向量字段"]].map(([type, label]) => <div key={label}><b>{type}</b><span>{label}</span></div>)}
          </div>
          {parseError ? <div className="import-message error"><AlertCircle size={16} />{parseError}</div> : null}
          {result ? <div className="import-message success"><CheckCircle2 size={16} />已导入 {result.imported_count} 条，批次 {result.batch_id}</div> : null}
          <button className="primary-button import-submit" disabled={!validRows.length || invalidCount > 0 || uploading} onClick={submit} type="button">
            {uploading ? "正在写入队列..." : `确认导入 ${validRows.length || 0} 条`}
          </button>
        </article>

        <article className="panel import-preview-panel">
          <div className="panel-title-row"><div><h3>数据预览</h3><p>{rows.length ? `有效 ${validRows.length} · 异常 ${invalidCount}` : "等待文件"}</p></div></div>
          <div className="import-table-scroll">
            <table><thead><tr>{previewFields.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
              <tbody>{rows.length ? rows.slice(0, 20).map((row, index) => <tr className={noteIdForImport(row) ? "" : "invalid-row"} key={`${noteIdForImport(row)}-${index}`}>{previewFields.map(([key]) => <td key={key}>{String(valueFor(row, key) || "-")}</td>)}</tr>) : <tr><td colSpan={previewFields.length}><div className="empty-table-state">暂无预览数据</div></td></tr>}</tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel import-batches-panel">
        <div className="panel-title-row"><div><h3>最近导入批次</h3><p>服务器逐条处理状态</p></div><button className="icon-action" type="button" title="刷新批次" onClick={() => loadBatches()}><RefreshCw size={16} className={loadingBatches ? "spin" : ""} /></button></div>
        <div className="import-table-scroll batch-table-scroll"><table><thead><tr><th>批次</th><th>总数</th><th>排队</th><th>处理中</th><th>成功</th><th>失败</th><th>状态</th><th>更新时间</th></tr></thead>
          <tbody>{batches.length ? batches.map((batch) => { const [kind, label] = batchStatus(batch); return <tr key={batch.batch_id}><td><strong>{batch.batch_id}</strong></td><td>{batch.total}</td><td>{batch.pending}</td><td>{batch.running}</td><td>{batch.success}</td><td>{batch.failed}</td><td><em className={`status-pill ${kind}`}>{label}</em></td><td>{new Date(batch.updated_at).toLocaleString("zh-CN")}</td></tr>; }) : <tr><td colSpan="8"><div className="empty-table-state">暂无导入批次</div></td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
