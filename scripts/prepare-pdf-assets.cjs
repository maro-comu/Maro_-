"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [workspaceRootArg, catalogPathArg, targetRootArg, batchRootArg] = process.argv.slice(2);
if (!workspaceRootArg || !catalogPathArg || !targetRootArg || !batchRootArg) {
  throw new Error("사용법: node prepare-pdf-assets.cjs <workspace-root> <catalog> <target-root> <batch-root>");
}

const workspaceRoot = path.resolve(workspaceRootArg);
const catalogPath = path.resolve(catalogPathArg);
const targetRoot = path.resolve(targetRootArg);
const batchRoot = path.resolve(batchRootArg);

delete global.PdfCatalog;
delete global.PDF_CATALOG;
require(catalogPath);

const papers = global.PdfCatalog?.papers || [];
if (!papers.length) throw new Error("PDF 카탈로그를 읽지 못했습니다.");
if (papers.some(paper => Number(paper.year) < 2022)) {
  throw new Error("2022년도 이전 항목이 카탈로그에 남아 있습니다.");
}

const files = new Map();
for (const paper of papers) {
  for (const key of ["questionPath", "answerPath", "scriptPath"]) {
    if (!paper[key]) continue;
    const relativePath = String(paper[key]).replace(/\\/g, "/").replace(/^(?:\.\.\/)+/, "");
    files.set(relativePath, true);
  }
}

fs.mkdirSync(targetRoot, { recursive: true });
fs.mkdirSync(batchRoot, { recursive: true });

const batches = new Map();
let totalBytes = 0;
let hardLinked = 0;
let reused = 0;

for (const relativePath of [...files.keys()].sort((a, b) => a.localeCompare(b, "ko"))) {
  const segments = relativePath.split("/");
  const area = segments[0];
  const sourcePath = path.join(workspaceRoot, ...segments);
  const targetPath = path.join(targetRoot, ...segments);
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error(`PDF 파일이 아닙니다: ${sourcePath}`);
  if (stat.size >= 100 * 1024 * 1024) throw new Error(`GitHub 단일 파일 한도를 넘습니다: ${sourcePath}`);

  const signature = Buffer.alloc(5);
  const descriptor = fs.openSync(sourcePath, "r");
  fs.readSync(descriptor, signature, 0, signature.length, 0);
  fs.closeSync(descriptor);
  if (signature.toString("ascii") !== "%PDF-") throw new Error(`PDF 서명이 올바르지 않습니다: ${sourcePath}`);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) {
    const existing = fs.statSync(targetPath);
    if (existing.size !== stat.size) throw new Error(`대상 파일 크기가 다릅니다: ${targetPath}`);
    reused += 1;
  } else {
    try {
      fs.linkSync(sourcePath, targetPath);
    } catch (_) {
      fs.copyFileSync(sourcePath, targetPath);
    }
    hardLinked += 1;
  }

  const batch = batches.get(area) || { area, paths: [], bytes: 0 };
  batch.paths.push(relativePath);
  batch.bytes += stat.size;
  batches.set(area, batch);
  totalBytes += stat.size;
}

const summary = {
  minimumYear: Math.min(...papers.map(paper => Number(paper.year))),
  papers: papers.length,
  files: files.size,
  totalBytes,
  hardLinked,
  reused,
  batches: [...batches.values()].sort((a, b) => b.bytes - a.bytes).map((batch, index) => {
    const fileName = `batch-${String(index + 1).padStart(2, "0")}-${batch.area.replace(/[^\p{L}\p{N}]+/gu, "-")}.paths`;
    const nulSeparated = Buffer.from(`${batch.paths.join("\0")}\0`, "utf8");
    fs.writeFileSync(path.join(batchRoot, fileName), nulSeparated);
    return { area: batch.area, count: batch.paths.length, bytes: batch.bytes, pathspecFile: fileName };
  })
};

fs.writeFileSync(path.join(batchRoot, "pdf-assets-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
