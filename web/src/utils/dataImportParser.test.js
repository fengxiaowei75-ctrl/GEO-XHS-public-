import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { noteIdForImport, parseImportFile } from "./dataImportParser";

describe("noteIdForImport", () => {
  it("reads an explicit Chinese note ID", () => {
    expect(noteIdForImport({ "笔记ID": "abc_123456" })).toBe("abc_123456");
  });

  it("extracts the note ID from common Xiaohongshu links", () => {
    expect(noteIdForImport({ "笔记链接": "https://www.xiaohongshu.com/explore/67abc123def456?xsec_token=test" })).toBe("67abc123def456");
    expect(noteIdForImport({ note_url: "https://www.xiaohongshu.com/discovery/item/67def456abc123" })).toBe("67def456abc123");
  });
});

describe("parseImportFile", () => {
  it("parses the downloadable CSV shape including quoted commas", async () => {
    const csv = "\ufeff笔记ID,笔记链接,标题,内容\r\nabc12345,https://www.xiaohongshu.com/explore/abc12345,\"标题,带逗号\",正文\r\n";
    const rows = await parseImportFile(new File([csv], "template.csv", { type: "text/csv" }));

    expect(rows).toEqual([{
      "笔记ID": "abc12345",
      "笔记链接": "https://www.xiaohongshu.com/explore/abc12345",
      "标题": "标题,带逗号",
      "内容": "正文",
    }]);
  });

  it("parses the first worksheet of a basic XLSX file", async () => {
    const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const relationships = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>笔记ID</t></is></c><c r="B1" t="inlineStr"><is><t>标题</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>abc12345</t></is></c><c r="B2" t="inlineStr"><is><t>测试标题</t></is></c></row></sheetData></worksheet>`;
    const bytes = (value) => Uint8Array.from(Buffer.from(value, "utf8"));
    const archive = zipSync({
      "xl/workbook.xml": bytes(workbook),
      "xl/_rels/workbook.xml.rels": bytes(relationships),
      "xl/worksheets/sheet1.xml": bytes(sheet),
    });
    expect(strFromU8(unzipSync(archive)["xl/workbook.xml"])).toContain("<workbook");
    const rows = await parseImportFile({ name: "template.xlsx", arrayBuffer: async () => archive });

    expect(rows).toEqual([{ "笔记ID": "abc12345", "标题": "测试标题" }]);
  });
});
