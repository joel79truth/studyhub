const PDFThumbnail = ({ url }) => {
  const [thumbnail, setThumbnail] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef(null);

  // 1. Only start processing when the card is visible on screen
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setIsVisible(true);
    }, { threshold: 0.1 });
    
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 2. Generate the thumbnail once visible
  useEffect(() => {
    if (!isVisible || !url || thumbnail) return;

    const generateThumb = async () => {
      try {
        const loadingTask = pdfjs.getDocument({ url, disableAutoFetch: true });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        
        const viewport = page.getViewport({ scale: 0.3 }); // Small scale for speed
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        setThumbnail(canvas.toDataURL('image/jpeg', 0.7)); // High compression
        pdf.destroy(); // Free memory immediately
      } catch (e) {
        console.error("Thumbnail error", e);
      }
    };
    generateThumb();
  }, [isVisible, url]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-slate-50">
      {thumbnail ? (
        <img src={thumbnail} alt="" className="w-full h-full object-cover animate-in fade-in duration-500" />
      ) : (
        <FileText size={40} className="text-slate-200" />
      )}
    </div>
  );
};