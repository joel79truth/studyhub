import { useState, lazy, Suspense, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabase';
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

// Same helpers as Files.jsx / Programs.jsx. TODO: extract to a shared
// utils/notes.js so there's exactly one copy instead of three.
const getNotePublicUrl = (note) => {
  if (note.storage_type === 'gdrive' && note.filepath) {
    return `https://drive.google.com/file/d/${note.filepath}/view`;
  }
  if (note.filepath && note.storage_type !== 'gdrive') {
    const { data } = supabase.storage.from('notes').getPublicUrl(note.filepath);
    if (data?.publicUrl) return data.publicUrl;
  }
  if (note.url && (note.url.startsWith('http://') || note.url.startsWith('https://'))) {
    return note.url;
  }
  return null;
};

const getFileType = (filename) => {
  const ext = String(filename || '').split('.').pop()?.toLowerCase();
  return ext === 'pptx' || ext === 'ppt' ? 'pptx' : 'pdf';
};

export default function Viewer() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [searchParams] = useSearchParams();

  // ✅ Router `state` only lives in memory for the current session — a
  // hard refresh, a bookmark, a shared link, or a PWA relaunch all land
  // here with `state` undefined. The URL's ?fileId= is the durable
  // source of truth; `state` is just a same-session shortcut so the
  // common case (clicking from Files/Programs) doesn't need a refetch.
  const fileIdFromUrl = searchParams.get('fileId');
  const fileId = state?.fileId || fileIdFromUrl || null;
  const hasFullState = !!state?.url;

  const [recovered, setRecovered] = useState(null);
  const [recoveryError, setRecoveryError] = useState(null);

  // Recovery path: we have a fileId but not the rest (url/filename/type)
  // because state was lost. Fetch the note directly from `notes` by id —
  // the same id space Files.jsx, Programs.jsx, and studyhub-router.js
  // all agree on, so this always resolves for a real, existing document.
  useEffect(() => {
    if (hasFullState || !fileId) return;
    let cancelled = false;
    setRecoveryError(null);
    (async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('id, filename, url, filepath, storage_type, course_name, semester, program')
        .eq('id', fileId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        setRecoveryError('Could not find this document. It may have been removed.');
        return;
      }
      setRecovered(data);
    })();
    return () => { cancelled = true; };
  }, [hasFullState, fileId]);

  const filename = state?.filename || recovered?.course_name || recovered?.filename || 'Document';
  const rawUrl = state?.url || (recovered ? getNotePublicUrl(recovered) : null);
  const fileType = state?.fileType || (recovered ? getFileType(recovered.filename) : 'pdf');

  // retryTick: bumping this re-runs useFileLoader's effect without a
  // hard page reload. Critical for the offline case — a hard reload
  // while offline can strand the student on a blank browser error
  // page if there's no service worker precaching the app shell.
  const [retryTick, setRetryTick] = useState(0);

  // CHANGED: also pull loadStage/downloadProgress so LoadingScreen can
  // show what's actually happening instead of a generic spinner.
  const { blobUrl, fileLoading, fileError, isOffline, loadStage, downloadProgress } = useFileLoader(
    rawUrl, fileId, fileType, filename, retryTick
  );

  const {
    pdf,
    pageSizes,
    numPages,
    loading: pdfLoading,
    error: pdfError,
    firstPageReady,
  } = usePdfLoader(fileType === 'pdf' ? blobUrl : null);

  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showLuna, setShowLuna] = useState(false);
  const [pageText, setPageText] = useState('');
  const [isLunaFullscreen, setIsLunaFullscreen] = useState(false);
  const containerWidth = useContainerWidth();

  const baseWidth = useMemo(() => pageSizes[0]?.width || 595, [pageSizes]);
  const renderer = usePdfRenderer(pdf, scale, baseWidth);

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

  // ── Recovery states (only relevant when state was lost) ──
  if (!fileId && !hasFullState && !rawUrl) {
    // No id anywhere (state, URL) — genuinely nothing to show, not a
    // loading condition. Distinct from "recovering" below.
    return (
      <ErrorScreen
        message="No document is open. Go back and select a file to view."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (!hasFullState && !recovered && !recoveryError) {
    // We have a fileId but are still fetching its details from `notes`.
    // CHANGED: explicit stage instead of the default.
    return <LoadingScreen stage="lookup" />;
  }

  if (recoveryError) {
    return (
      <ErrorScreen
        message={recoveryError}
        onBack={() => navigate(-1)}
      />
    );
  }

  const showLoading = fileType === 'pdf'
    ? (fileLoading || (pdfLoading && !firstPageReady))
    : fileLoading;

  if (showLoading) {
    // CHANGED: real stage + progress instead of a bare spinner.
    // While useFileLoader is still working, show its stage
    // (checking-cache / downloading) with byte progress when known.
    // Once it's done and we're just waiting on pdf.js to parse the
    // first page, that's a distinct 'opening' stage with no byte
    // progress to report (it's CPU parsing, not a network transfer).
    return (
      <LoadingScreen
        stage={fileLoading ? loadStage : 'opening'}
        progress={fileLoading ? downloadProgress : null}
      />
    );
  }

  // PPTX rendering depends on a live embedded viewer (Office/Google),
  // not just having the bytes — caching the blob doesn't make this
  // work offline. Say so clearly instead of letting it spin forever
  // or show a blank iframe.
  if (fileType === 'pptx' && !navigator.onLine && !blobUrl) {
    return (
      <ErrorScreen
        message="PowerPoint files need an internet connection to view and can't be opened offline yet. PDF downloads work offline — ask your lecturer for a PDF version if one's available."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (fileError) {
    return (
      <ErrorScreen
        message={fileError}
        onBack={() => navigate(-1)}
        onRetry={() => setRetryTick((t) => t + 1)}
      />
    );
  }

  if (pdfError) {
    return (
      <ErrorScreen
        message={`Could not open PDF: ${pdfError}`}
        onBack={() => navigate(-1)}
        onRetry={() => setRetryTick((t) => t + 1)}
      />
    );
  }

  if (fileType === 'pdf' && blobUrl && !pdf && !pdfLoading) {
    return (
      <ErrorScreen
        message="PDF loaded but could not be displayed. It may be corrupted or unsupported."
        onBack={() => navigate(-1)}
        onRetry={() => setRetryTick((t) => t + 1)}
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