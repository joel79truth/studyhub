// src/components/SmilesCanvas.jsx
import React, { useRef, useEffect, useState, memo } from 'react';
import SmilesDrawer from 'smiles-drawer';

const SmilesCanvas = memo(({ smiles, width = 300, height = 200 }) => {
  const canvasRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !smiles || error) return;
    try {
      const drawer = new SmilesDrawer.Drawer({ width, height, bondThickness: 1.5 });
      SmilesDrawer.parse(smiles, (tree) => {
        drawer.draw(tree, canvasRef.current, 'light', false);
      });
    } catch (err) {
      console.warn('SMILES rendering failed:', err);
      setError(true);
    }
  }, [smiles, width, height, error]);

  if (!smiles) return null;
  if (error) {
    return (
      <div style={{ color: '#999', fontSize: '0.9rem', padding: '0.5rem' }}>
        ⚠️ Could not render structure
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ maxWidth: '100%', height: 'auto' }}
    />
  );
});

export default SmilesCanvas;