import { useState, lazy, Suspense, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFileLoader } from '../../hooks/useFileLoader';
import { usePdfLoader } from '../../hooks/usePdfLoader';
import { usePdfRenderer } from '../../hooks/usePdfRenderer';
import useContainerWidth from '../../hooks/useContainerWidth';
import ViewerHeader from './ViewerHeader';
import PdfViewer from './PdfViewer';
import PptxViewer from './PptxViewer';
import ZoomControls from './ZoomControls';
import LoadingScreen from './LoadingScreen';
import ErrorScreen from './ErrorScreen';
import '../../styles/viewer.css';

const LunaPanel = lazy(() => import('./LunaPanel'));

export default function Viewer() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const filename = state?.filename || 'Document';
  const rawUrl = state?.url || null;
  const fileId = state?.fileId || null;
  const fileType = state?.fileType || 'pdf';

  // useFileLoader must be updated to check the local cache before
  // hitting rawUrl — see notes below. This just requests that behavior.
  const { blobUrl, fileLoading, fileError, isOffline, servedFromCache } = useFileLoader(
    rawUrl, fileId, fileType, filename,
    { preferCache: true }
  );

  // usePdfLoader should use PDF.js's streaming API (getDocument({url})
  // or a ReadableStream) rather than waiting for a full blob — see notes.
  const {
    pdf,
    pageSizes,
    numPages,
    loading: pdfLoading,
    error: pdfError,
    firstPageReady, // new: true as soon as page 1 can render, before all pages parsed
  } = usePdfLoader(fileType === 'pdf' ? blobUrl : null);

  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showLuna, setShowLuna] = useState(false);
  const [pageText, setPageText] = useState('');
  const [isLunaFullscreen, setIsLunaFullscreen] = useState(false);
  const containerWidth = useContainerWidth();

  const baseWidth = useMemo(() => pageSizes[0]?.width || 595, [pageSizes]);
  const renderer = usePdfRenderer(pdf, scale, baseWidth);

  // Extract text of the current page (unchanged, cancellation-safe)
  useEffect(() => {
    if (!pdf || !numPages) return;
    let cancelled = false;
    async function extractText() {
      try {
        const page = await pdf.getPage(currentPage);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        if (!cancelled) setPageText(text);
      } catch (err) {
        if (!cancelled) setPageText('');
      }
    }
    extractText();
    return () => { cancelled = true; };
  }, [pdf, currentPage, numPages]);

  // Show the shell as soon as we can render page 1 — don't block on
  // every page being parsed. This is the main "long loading" fix at
  // this layer; the rest is in useFileLoader/usePdfLoader.
  const showLoading = fileType === 'pdf'
    ? (fileLoading || (pdfLoading && !firstPageReady))
    : fileLoading;

  if (showLoading) {
    return <LoadingScreen />;
  }

  if (fileError) {
    return (
      <ErrorScreen
        message={fileError}
        onBack={() => navigate(-1)}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (pdfError) {
    return (
      <ErrorScreen
        message={`Could not open PDF: ${pdfError}`}
        onBack={() => navigate(-1)}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (fileType === 'pdf' && blobUrl && !pdf && !pdfLoading) {
    return (
      <ErrorScreen
        message="PDF loaded but could not be displayed. It may be corrupted or unsupported."
        onBack={() => navigate(-1)}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="viewer-root">
      <ViewerHeader
  filename={filename}
  fileType={fileType}
  fileUrl={rawUrl}
  fileId={fileId}
  currentPage={currentPage}
  numPages={numPages}
  isOffline={isOffline}
  onBack={() => navigate(-1)}
  onAskLuna={() => setShowLuna(true)}
  onOfflineReady={() => { /* optional: could trigger useFileLoader to re-check cache */ }}
/>

      {fileType === 'pdf' ? (
        <PdfViewer
          pageSizes={pageSizes}
          scale={scale}
          containerWidth={containerWidth}
          pdf={pdf}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          renderer={renderer}
        />
      ) : (
        <PptxViewer url={blobUrl || rawUrl} scale={scale} />
      )}

      {fileType === 'pdf' && (
        <ZoomControls
          scale={scale}
          onZoomIn={() => setScale(prev => Math.min(2.5, +(prev + 0.2).toFixed(1)))}
          onZoomOut={() => setScale(prev => Math.max(0.5, +(prev - 0.2).toFixed(1)))}
        />
      )}

      {showLuna && (
        <Suspense fallback={null}>
          <LunaPanel
            fileId={fileId}
            pageText={pageText}
            currentPage={currentPage}
            onClose={() => { setShowLuna(false); setIsLunaFullscreen(false); }}
            isFullscreen={isLunaFullscreen}
            toggleFullscreen={() => setIsLunaFullscreen(p => !p)}
          />
        </Suspense>
      )}
    </div>
  );
}