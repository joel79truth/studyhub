import { useState, lazy, Suspense, useMemo, useEffect, useRef, useCallback } from 'react';
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
import { trackNotesViewed } from '../../lib/analytics';

const LunaPanel = lazy(() => import('./LunaPanel'));

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

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const TEXT_EXTRACT_DEBOUNCE_MS = 180;

export default function Viewer() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [searchParams] = useSearchParams();

  const fileIdFromUrl = searchParams.get('fileId');
  const fileId = state?.fileId || fileIdFromUrl || null;
  const hasFullState = !!state?.url;

  const [recovered, setRecovered] = useState(null);
  const [recoveryError, setRecoveryError] = useState(null);

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

  // Analytics tracking: notes/document viewed
  useEffect(() => {
    if (filename && filename !== 'Document') {
      trackNotesViewed({
        filename,
        subject: state?.course || recovered?.course_name || '',
        program: state?.program || recovered?.program || '',
      });
    }
  }, [filename, fileId]);

  const [retryTick, setRetryTick] = useState(0);

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

  // Multi-page context (Previous, Current, Next) for rich AI comprehension
  const [multiPageContext, setMultiPageContext] = useState({
    prevPage: null,
    prevText: '',
    currentPage: 1,
    currentText: '',
    nextPage: null,
    nextText: '',
    selectedSnippet: '',
  });
  const [initialPrompt, setInitialPrompt] = useState('');

  const baseWidth = useMemo(() => pageSizes[0]?.width || 595, [pageSizes]);
  const renderer = usePdfRenderer(pdf, scale, baseWidth);

  const textCacheRef = useRef(new Map());
  const textRequestIdRef = useRef(0);

  useEffect(() => {
    textCacheRef.current = new Map();
  }, [pdf]);

  const fetchPageText = useCallback(async (pNum) => {
    if (!pdf || pNum < 1 || pNum > numPages) return '';
    if (textCacheRef.current.has(pNum)) return textCacheRef.current.get(pNum);
    try {
      const page = await pdf.getPage(pNum);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str).join(' ');
      textCacheRef.current.set(pNum, text);
      return text;
    } catch {
      return '';
    }
  }, [pdf, numPages]);

  // Sliding context window: Extract Current, Previous, and Next pages
  useEffect(() => {
    if (!pdf || !numPages) return;

    const requestId = ++textRequestIdRef.current;
    const timer = setTimeout(async () => {
      if (requestId !== textRequestIdRef.current) return;

      const prevNum = currentPage > 1 ? currentPage - 1 : null;
      const nextNum = currentPage < numPages ? currentPage + 1 : null;

      const [currT, prevT, nextT] = await Promise.all([
        fetchPageText(currentPage),
        prevNum ? fetchPageText(prevNum) : Promise.resolve(''),
        nextNum ? fetchPageText(nextNum) : Promise.resolve(''),
      ]);

      if (requestId !== textRequestIdRef.current) return;
      setPageText(currT);
      setMultiPageContext((prev) => ({
        ...prev,
        prevPage: prevNum,
        prevText: prevT,
        currentPage,
        currentText: currT,
        nextPage: nextNum,
        nextText: nextT,
      }));
    }, TEXT_EXTRACT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [pdf, currentPage, numPages, fetchPageText]);

  // Handle Ask StudyHub from inline text selection in PdfViewer
  const handleAskSelection = useCallback((selectedText, pageNum, actionType = 'ask') => {
    let prompt = '';
    if (actionType === 'explain') {
      prompt = `Explain this concept clearly: "${selectedText}"`;
    } else if (actionType === 'summarize') {
      prompt = `Summarize this passage and give key takeaways: "${selectedText}"`;
    } else {
      prompt = `I need help understanding this: "${selectedText}"`;
    }

    setInitialPrompt(prompt);
    setMultiPageContext((prev) => ({
      ...prev,
      selectedSnippet: selectedText,
    }));
    setShowLuna(true);
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(MAX_SCALE, +(prev + 0.2).toFixed(1)));
  }, []);
  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(MIN_SCALE, +(prev - 0.2).toFixed(1)));
  }, []);
  const handleZoomReset = useCallback(() => setScale(1.0), []);

  // ── Recovery states ──
  if (!fileId && !hasFullState && !rawUrl) {
    return (
      <ErrorScreen
        message="No document is open. Go back and select a file to view."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (!hasFullState && !recovered && !recoveryError) {
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
    return (
      <LoadingScreen
        stage={fileLoading ? loadStage : 'opening'}
        progress={fileLoading ? downloadProgress : null}
      />
    );
  }

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
          onAskSelection={handleAskSelection}
          onScaleChange={setScale}
        />
      ) : (
        <PptxViewer url={blobUrl || rawUrl} scale={scale} />
      )}

      {fileType === 'pdf' && (
        <ZoomControls
          scale={scale}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
        />
      )}

      {showLuna && (
        <Suspense fallback={null}>
          <LunaPanel
            fileId={fileId}
            pageNumber={currentPage}
            currentPage={currentPage}
            pageText={pageText}
            multiPageContext={multiPageContext}
            initialPrompt={initialPrompt}
            courseContext={recovered?.course_name || state?.course || filename}
            onClose={() => {
              setShowLuna(false);
              setIsLunaFullscreen(false);
              setInitialPrompt('');
            }}
            isFullscreen={isLunaFullscreen}
            toggleFullscreen={() => setIsLunaFullscreen((p) => !p)}
          />
        </Suspense>
      )}
    </div>
  );
}