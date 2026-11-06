import {
  cleanOcrText,
  hasSelectableText,
  OCR_MAX_PAGES,
  type OcrProgress,
} from "@notes-learning/domain";

export interface OcrResult {
  text: string;
  pages: number;
  ocrPages: number;
}

/**
 * Optional self-hosted asset base. Point this at a directory that mirrors the
 * jsdelivr layout (`worker.min.js`, `core/`, `eng.traineddata.gz`) to run OCR
 * without reaching the public CDN.
 */
const ASSET_BASE = process.env.NEXT_PUBLIC_TESSERACT_CDN?.replace(/\/+$/, "");

function assetOptions() {
  if (!ASSET_BASE) return {};
  return {
    workerPath: `${ASSET_BASE}/worker.min.js`,
    corePath: `${ASSET_BASE}/core`,
    langPath: ASSET_BASE,
  };
}

async function recognizeSource(
  source: Blob | HTMLCanvasElement,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    ...assetOptions(),
    logger: (message: { status: string; progress: number }) => {
      onProgress?.({ stage: message.status.replace(/_/g, " "), progress: message.progress });
    },
  });
  try {
    const result = await worker.recognize(source);
    return cleanOcrText(result.data.text);
  } finally {
    await worker.terminate();
  }
}

/** Runs OCR over an image in this browser. Nothing is uploaded. */
export async function recognizeImageText(
  source: Blob | File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  requireBrowser();
  return recognizeSource(source, onProgress);
}

/**
 * Extracts text from a PDF locally: pages with a text layer are read directly,
 * pages without one are rendered to a canvas and OCR'd. Rasterizing never
 * leaves the browser.
 */
export async function recognizePdfText(
  file: Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  requireBrowser();
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pageCount = Math.min(pdf.numPages, OCR_MAX_PAGES);
  const sections: string[] = [];
  let ocrPages = 0;

  for (let index = 1; index <= pageCount; index += 1) {
    const page = await pdf.getPage(index);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (hasSelectableText(pageText)) {
      sections.push(pageText);
      page.cleanup();
      continue;
    }

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot render PDF pages for OCR.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    onProgress?.({ stage: "reading page", progress: 0, page: index, pages: pageCount });
    sections.push(
      await recognizeSource(canvas, (progress) =>
        onProgress?.({ ...progress, page: index, pages: pageCount }),
      ),
    );
    ocrPages += 1;
    page.cleanup();
  }

  return { text: cleanOcrText(sections.join("\n\n")), pages: pageCount, ocrPages };
}

function requireBrowser() {
  if (typeof window === "undefined") {
    throw new Error("OCR runs in this browser only.");
  }
}
