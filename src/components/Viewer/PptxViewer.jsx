export default function PptxViewer({ url, scale }) {
  return (
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <iframe
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
        style={{
          width: '100%', height: '100%', border: 'none',
          transform: `scale(${scale})`, transformOrigin: 'top center',
        }}
        title="PPTX Viewer"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}