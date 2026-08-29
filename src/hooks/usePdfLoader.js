import { useState, useEffect } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

export function usePdfLoader(blobUrl) {
  const [pdf, setPdf] = useState(null);
  const [pageSizes, setPageSizes] = useState([]);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setPdf(null);
    setPageSizes([]);
    setNumPages(0);
    setFirstPageReady(false);
    setError(null);

    if (!blobUrl) {
      log('⏸️ usePdfLoader: waiting for blobUrl...');
      setLoading(true);
      return;
    }

    setLoading(true);
    let cancelled = false;
    let doc = null;

    const load = async () => {
      try {
        log('📄 Loading PDF from:', blobUrl);
        doc = await pdfjs.getDocument({ url: blobUrl }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        const count = doc.numPages;
        log(`📚 PDF loaded: ${count} pages`);
        setPdf(doc);
        setNumPages(count);

        const firstPage = await doc.getPage(1);
        const firstVp = firstPage.getViewport({ scale: 1 });
        firstPage.cleanup();
        if (cancelled) return;

        const sizes = new Array(count);
        sizes[0] = { width: firstVp.width, height: firstVp.height };
        setPageSizes([...sizes]);
        setLoading(false);
        setFirstPageReady(true);

        const CONCURRENCY = 6;
        let nextIndex = 1;

        async function measurePage(index) {
          const pageNum = index + 1;
          const page = await doc.getPage(pageNum);
          const vp = page.getViewport({ scale: 1 });
          page.cleanup();
          return { width: vp.width, height: vp.height };
        }

        async function worker() {
          while (!cancelled) {
            const index = nextIndex++;
            if (index >= count) return;
            const size = await measurePage(index);
            if (cancelled) return;
            sizes[index] = size;
            setPageSizes([...sizes]);
          }
        }

        const workers = Array.from(
          { length: Math.min(CONCURRENCY, count - 1) },
          () => worker()
        );
        await Promise.all(workers);

        if (!cancelled) {
          log('📏 All page sizes extracted');
        }
      } catch (err) {
        console.error('❌ PDF load error:', err);
        if (!cancelled) {
          setError(err.message || 'Unknown PDF error');
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      if (doc && typeof doc.destroy === 'function') {
        doc.destroy();
      }
    };
  }, [blobUrl]);

  return { pdf, pageSizes, numPages, loading, firstPageReady, error };
}