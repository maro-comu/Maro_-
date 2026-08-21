const parentOrigin = location.origin;
let bridgedDocument = null;
let bridgeStarted = false;
let storageSignature = null;
let storageMonitor = null;
let eraserActive = false;
let eraserToolReady = false;

function notify(type, detail = {}, transfer = []) {
  if (window.parent === window) return;
  window.parent.postMessage({ type, ...detail }, parentOrigin, transfer);
}

function attachStorageBridge() {
  const app = window.PDFViewerApplication;
  const documentProxy = app?.pdfDocument;
  if (!documentProxy) return;

  const eraserButton = document.getElementById("studyEraserButton");
  if (eraserButton) eraserButton.disabled = false;

  const storage = documentProxy.annotationStorage;
  if (!storage.onSetModified?.studyPdfBridge) {
    const originalSetModified = storage.onSetModified;
    const wrappedSetModified = (...args) => {
      originalSetModified?.(...args);
      notify("study-pdf-dirty", { annotationCount: storage.size || 0 });
    };
    wrappedSetModified.studyPdfBridge = true;
    storage.onSetModified = wrappedSetModified;
  }
  if (documentProxy !== bridgedDocument) {
    bridgedDocument = documentProxy;
    storageSignature = `${storage.size || 0}:${storage.serializable?.hash || ""}`;
    notify("study-pdf-ready", { pages: documentProxy.numPages || 0 });
  }
}

function monitorStorage() {
  const storage = window.PDFViewerApplication?.pdfDocument?.annotationStorage;
  if (!storage) return;
  try {
    const nextSignature = `${storage.size || 0}:${storage.serializable?.hash || ""}`;
    if (storageSignature !== null && nextSignature !== storageSignature) {
      storageSignature = nextSignature;
      notify("study-pdf-dirty", { annotationCount: storage.size || 0 });
    }
  } catch {
    // 일부 이미지 주석이 직렬화되는 순간에는 다음 주기에 다시 확인합니다.
  }
}

function editorToolActive() {
  return Boolean(document.querySelector(
    "#editorHighlightButton.toggled, #editorFreeTextButton.toggled, #editorInkButton.toggled, #editorStampButton.toggled, #editorSignatureButton.toggled"
  ));
}

function drawingToolActive() {
  return Boolean(document.querySelector(
    "#editorHighlightButton.toggled, #editorInkButton.toggled"
  ));
}

function annotationEditorManager() {
  return window.PDFViewerApplication?.pdfViewer?._layerProperties?.annotationEditorUIManager;
}

function setEraserActive(active) {
  const button = document.getElementById("studyEraserButton");
  const next = Boolean(active && button && !button.disabled);

  if (next) {
    const manager = annotationEditorManager();
    manager?.getActive?.()?.commitOrRemove?.();
    const activeDrawingButton = document.querySelector(
      "#editorHighlightButton.toggled, #editorInkButton.toggled"
    );
    activeDrawingButton?.click();
    manager?.unselectAll?.();
  }

  eraserActive = next;
  document.documentElement.classList.toggle("study-eraser-active", next);
  button?.classList.toggle("toggled", next);
  button?.setAttribute("aria-pressed", String(next));
}

function eraseAnnotation(event) {
  if (!eraserActive || event.button !== 0) return;
  const target = event.target instanceof Element
    ? event.target.closest(".annotationEditorLayer > .inkEditor, .annotationEditorLayer > .highlightEditor")
    : null;
  if (!target) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const manager = annotationEditorManager();
  const editor = manager?.getEditor?.(target.id);
  if (!editor) return;

  manager.setSelected?.(editor);
  manager.delete?.();
  window.getSelection()?.removeAllRanges();
  setTimeout(() => {
    const storage = window.PDFViewerApplication?.pdfDocument?.annotationStorage;
    notify("study-pdf-dirty", { annotationCount: storage?.size || 0 });
  }, 0);
}

function setupEraserTool() {
  if (eraserToolReady) return;
  const button = document.getElementById("studyEraserButton");
  if (!button) return;

  eraserToolReady = true;
  button.addEventListener("click", () => setEraserActive(!eraserActive));
  document.addEventListener("click", event => {
    if (event.target?.closest?.("#editorHighlightButton, #editorInkButton")) {
      setEraserActive(false);
    }
  }, true);
}

function clearSelectionAfterDrawing(event) {
  if (event.type !== "pointerup" || !drawingToolActive()) return;
  if (event.target?.closest?.("#toolbarContainer")) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.getSelection()?.removeAllRanges();
    const manager=window.PDFViewerApplication?.pdfViewer?._layerProperties?.annotationEditorUIManager;
    manager?.getActive?.()?.commitOrRemove?.();
    while (manager?.hasSelection) {
      const editor=manager.firstSelectedEditor;
      if (!editor) break;
      manager.unselect(editor);
    }
  }));
}

function notifyEditorInteraction(event) {
  if (!editorToolActive()) return;
  if (event.type === "pointerup" && event.target?.closest?.("#toolbarContainer")) return;
  setTimeout(() => {
    const storage = window.PDFViewerApplication?.pdfDocument?.annotationStorage;
    notify("study-pdf-dirty", { annotationCount: storage?.size || 0 });
  }, 80);
}

document.addEventListener("pointerup", clearSelectionAfterDrawing, true);
document.addEventListener("pointerup", notifyEditorInteraction, true);
document.addEventListener("input", notifyEditorInteraction, true);
document.addEventListener("change", notifyEditorInteraction, true);
document.addEventListener("pointerdown", eraseAnnotation, true);

function startBridge() {
  const app = window.PDFViewerApplication;
  if (!app || bridgeStarted) return false;
  bridgeStarted = true;
  Promise.resolve(app.initializedPromise).then(() => {
    setupEraserTool();
    app.eventBus.on("documentloaded", attachStorageBridge);
    app.eventBus.on("pagesloaded", attachStorageBridge);
    attachStorageBridge();
    setTimeout(attachStorageBridge, 0);
    setTimeout(attachStorageBridge, 250);
    setTimeout(attachStorageBridge, 1000);
    storageMonitor ||= setInterval(monitorStorage, 400);
  });
  return true;
}

document.addEventListener("webviewerloaded", startBridge, { once: true });
if (!startBridge()) {
  const poll = setInterval(() => {
    if (startBridge()) clearInterval(poll);
  }, 50);
  setTimeout(() => clearInterval(poll), 15000);
}

window.addEventListener("message", async event => {
  if (event.origin !== parentOrigin || event.source !== window.parent) return;
  const message = event.data || {};
  if (message.type !== "study-pdf-export") return;

  const requestId = String(message.requestId || "");
  try {
    const app = window.PDFViewerApplication;
    const documentProxy = app?.pdfDocument;
    if (!documentProxy) throw new Error("PDF 문서가 아직 준비되지 않았습니다.");
    app.pdfViewer?._layerProperties?.annotationEditorUIManager?.unselectAll?.();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const data = await documentProxy.saveDocument();
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    notify("study-pdf-exported", {
      requestId,
      annotationCount: documentProxy.annotationStorage.size || 0,
      buffer,
    }, [buffer]);
  } catch (error) {
    notify("study-pdf-export-error", {
      requestId,
      message: String(error?.message || error || "PDF 필기를 저장하지 못했습니다."),
    });
  }
});
