const renderInline = (text) => {
  const out = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} style={{ fontWeight: 700 }}>{m[1]}</strong>);
    if (m[2]) out.push(
      <code key={m.index} style={{
        background: '#f1f5f9', padding: '1px 5px', borderRadius: 3,
        fontFamily: 'monospace', fontSize: '.9em',
      }}>{m[2]}</code>
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
};

export default function MiniMarkdown({ content }) {
  return (
    <div style={{ lineHeight: 1.7 }}>
      {content.split('\n').map((line, i) => {
        if (line.startsWith('> '))
          return (
            <blockquote key={i} style={{
              borderLeft: '3px solid #1d4ed8', paddingLeft: 12,
              margin: '8px 0', color: '#374151', fontStyle: 'italic',
            }}>
              <span style={{ fontSize: 13.5 }}>{renderInline(line.slice(2))}</span>
            </blockquote>
          );
        if (line === '') return <div key={i} style={{ height: 7 }} />;
        return (
          <p key={i} style={{ margin: '2px 0', fontSize: 13.5, color: '#374151' }}>
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}