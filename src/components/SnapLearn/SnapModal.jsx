import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, X, Sparkles, Lightbulb, BookOpen, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../../lib/apiConfig';
import { supabase } from '../../supabase';

export default function SnapModal({ isOpen, onClose, initialImage = null }) {
  const [imageFile, setImageFile] = useState(initialImage);
  const [imagePreview, setImagePreview] = useState(null);
  const [mode, setMode] = useState('solution'); // 'solution' | 'hint'
  const [promptNote, setPromptNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const navigate = useNavigate();

  // Create preview URL when imageFile changes
  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Handle stage animation during loading
  useEffect(() => {
    if (!loading) {
      setLoadingStage(0);
      return;
    }
    const timer1 = setTimeout(() => setLoadingStage(1), 1800);
    const timer2 = setTimeout(() => setLoadingStage(2), 3800);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [loading]);

  if (!isOpen) return null;

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setResult(null);
      setError(null);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setResult(null);
    setError(null);
    setPromptNote('');
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  const handleAnalyze = async () => {
    if (!imageFile || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in to use Snap & Learn.');

      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('mode', mode);
      if (promptNote.trim()) formData.append('prompt', promptNote.trim());

      const res = await fetch(`${API_BASE_URL}/api/chat/vision`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze question');

      setResult(data);
    } catch (err) {
      console.error('[SnapModal] error:', err);
      setError(err.message || 'Something went wrong while analyzing the photo.');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueInChat = () => {
    if (result?.sessionId) {
      onClose();
      navigate('/AiChat');
    }
  };

  const stages = [
    'Scanning problem & formulas...',
    'Identifying LUANAR course & topic...',
    'Writing personalized guidance...',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full sm:max-w-lg bg-white rounded-t-[28px] sm:rounded-[28px] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-900 to-[#064e3b] text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center backdrop-blur-md">
              <Camera className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight">Snap & Learn</h2>
              <p className="text-[11px] text-emerald-200/90 font-medium">Visual AI Tutor for LUANAR</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* If No Image Selected: Selection View */}
          {!imagePreview && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#064e3b] mb-4 shadow-sm">
                <Camera className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-gray-800 mb-1">Take or Upload a Photo</h3>
              <p className="text-xs text-gray-500 max-w-xs mb-6">
                Snap an exam question, formula, or diagram. StudyHub AI will break it down step-by-step.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
                {/* Camera Input Button */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={cameraInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#064e3b] hover:bg-[#053d2e] text-white text-xs font-bold shadow-md transition-all active:scale-[0.98]"
                >
                  <Camera className="w-4 h-4" />
                  Use Camera
                </button>

                {/* Gallery Input Button */}
                <input
                  type="file"
                  accept="image/*"
                  ref={galleryInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold transition-all active:scale-[0.98]"
                >
                  <ImageIcon className="w-4 h-4 text-gray-500" />
                  From Gallery
                </button>
              </div>
            </div>
          )}

          {/* If Image Selected & Not Yet Result */}
          {imagePreview && !result && (
            <div className="flex flex-col gap-4">
              {/* Image Preview Card */}
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 border border-gray-200 shadow-sm max-h-56 flex items-center justify-center">
                <img
                  src={imagePreview}
                  alt="Question preview"
                  className="w-full h-full object-contain max-h-56"
                />
                {!loading && (
                  <button
                    onClick={handleReset}
                    className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white p-1.5 rounded-full backdrop-blur-sm transition-colors text-xs font-medium"
                    title="Retake photo"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Mode Selector Segmented Control */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-700">How should StudyHub assist you?</label>
                <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl border border-gray-200">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setMode('solution')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      mode === 'solution'
                        ? 'bg-white text-[#064e3b] shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Full Solution
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setMode('hint')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      mode === 'hint'
                        ? 'bg-white text-[#064e3b] shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Lightbulb className="w-3.5 h-3.5 text-emerald-600" />
                    Guide Me (Hint)
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 px-1">
                  {mode === 'solution'
                    ? 'Gives a clear step-by-step working and final calculated answer.'
                    : 'Gives the formula & gentle hints so you learn how to solve it yourself.'}
                </p>
              </div>

              {/* Optional Prompt Note */}
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  placeholder="Ask a specific question (e.g. explain step 2, or what formula to use)..."
                  value={promptNote}
                  disabled={loading}
                  onChange={(e) => setPromptNote(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border border-gray-200 bg-gray-50/70 focus:bg-white focus:outline-none focus:border-[#064e3b] transition-all"
                />
              </div>

              {/* Submit Button or Loading State */}
              {loading ? (
                <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl flex flex-col items-center justify-center text-center gap-2">
                  <RefreshCw className="w-6 h-6 text-[#064e3b] animate-spin" />
                  <p className="text-xs font-bold text-[#064e3b]">{stages[loadingStage]}</p>
                  <p className="text-[10px] text-gray-500">Multimodal reasoning tailored to LUANAR</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="py-3 px-4 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold transition-colors"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    className="flex-1 py-3 px-4 rounded-xl bg-[#064e3b] hover:bg-[#053d2e] text-white text-xs font-bold shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-emerald-200" />
                    Analyze with StudyHub
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Result View */}
          {result && (
            <div className="flex flex-col gap-4">
              {/* Badges Bar */}
              <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-100">
                {result.course && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-[#064e3b] border border-emerald-100 text-[11px] font-bold">
                    <BookOpen className="w-3 h-3" />
                    {result.course}
                  </span>
                )}
                {result.topic && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-100 text-[11px] font-bold">
                    🎯 {result.topic}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-gray-400 font-medium">
                  {result.mode === 'hint' ? '💡 Guided Hint' : '⚡ Step-by-Step'}
                </span>
              </div>

              {/* Guidance Answer Card */}
              <div className="bg-gray-50/80 p-4 rounded-2xl border border-gray-100 text-gray-800 text-xs leading-relaxed overflow-x-auto select-text">
                <ReactMarkdown
                  components={{
                    h1: ({ node, ...props }) => <h3 className="font-bold text-sm text-gray-900 mt-2 mb-1" {...props} />,
                    h2: ({ node, ...props }) => <h4 className="font-bold text-xs text-gray-900 mt-2 mb-1" {...props} />,
                    p: ({ node, ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2 space-y-1" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-2 space-y-1" {...props} />,
                    strong: ({ node, ...props }) => <strong className="font-bold text-[#064e3b]" {...props} />,
                  }}
                >
                  {result.reply}
                </ReactMarkdown>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Snap Another
                </button>
                <button
                  type="button"
                  onClick={handleContinueInChat}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#064e3b] hover:bg-[#053d2e] text-white text-xs font-bold shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                >
                  Ask Follow-up in Chat
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
