import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../firebase'
import { BottomNav } from "../components/BottomNav"

// Helper: sanitize for file paths
const sanitizePath = (str) => str.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)

export default function PastPapers() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [allData, setAllData] = useState([])
  const [currentView, setCurrentView] = useState('programs') // 'programs', 'semesters', 'papers'
  const [currentProgram, setCurrentProgram] = useState(null)
  const [currentSemester, setCurrentSemester] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [likedPapers, setLikedPapers] = useState({})
  const [activeThumbs, setActiveThumbs] = useState({})
  const [programsList, setProgramsList] = useState([])

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadForm, setUploadForm] = useState({
    program: '',
    course: '',
    mid: '',
    semester: ''
  })
  const [selectedFiles, setSelectedFiles] = useState([])
  const [imageQueue, setImageQueue] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ show: false, percent: 0, text: '' })

  // Batch modal state
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchPapers, setBatchPapers] = useState([])
  const [selectAll, setSelectAll] = useState(true)

  // Offline status
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const fileInputRef = useRef(null)
  const nativeCameraRef = useRef(null)

  // Load liked papers from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('likedPapers')
    if (stored) setLikedPapers(JSON.parse(stored))
  }, [])

  useEffect(() => {
    localStorage.setItem('likedPapers', JSON.stringify(likedPapers))
  }, [likedPapers])

  // Load programs for dropdown
  useEffect(() => {
    const fetchPrograms = async () => {
      const { data, error } = await supabase
        .from('programs')
        .select('name')
        .order('name')
      if (!error && data) {
        setProgramsList(data.map(p => p.name))
      } else {
        const { data: papers } = await supabase.from('past_papers').select('program')
        const unique = [...new Set(papers?.map(p => p.program).filter(Boolean))]
        setProgramsList(unique)
      }
    }
    fetchPrograms()
  }, [])

  // Load papers from Supabase (with offline cache)
  const loadPapers = useCallback(async () => {
    setLoading(true)
    try {
      if (isOnline) {
        const { data, error } = await supabase
          .from('past_papers')
          .select('*')
          .order('uploaded_at', { ascending: false })
        if (error) throw error
        setAllData(data || [])
        localStorage.setItem('cachedPapers', JSON.stringify(data || []))
      } else {
        const cached = localStorage.getItem('cachedPapers')
        if (cached) {
          setAllData(JSON.parse(cached))
        } else {
          setAllData([])
        }
      }
    } catch (err) {
      console.error('Load papers error:', err)
    } finally {
      setLoading(false)
    }
  }, [isOnline])

  useEffect(() => {
    loadPapers()
  }, [loadPapers])

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // IndexedDB for offline likes
  const getDB = useCallback(() => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('StudyHubOffline', 1)
      request.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('pendingLikes')) {
          db.createObjectStore('pendingLikes', { keyPath: 'paperId' })
        }
      }
      request.onsuccess = (e) => resolve(e.target.result)
      request.onerror = (e) => reject(e.target.error)
    })
  }, [])

  const storePendingLike = async (paperId, isLiked) => {
    const db = await getDB()
    const tx = db.transaction('pendingLikes', 'readwrite')
    const store = tx.objectStore('pendingLikes')
    store.put({ paperId, isLiked, timestamp: Date.now() })
    return tx.complete
  }

  const getPendingLikes = async () => {
    const db = await getDB()
    const tx = db.transaction('pendingLikes', 'readonly')
    const store = tx.objectStore('pendingLikes')
    return new Promise((resolve) => {
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => resolve([])
    })
  }

  const clearPendingLike = async (paperId) => {
    const db = await getDB()
    const tx = db.transaction('pendingLikes', 'readwrite')
    tx.objectStore('pendingLikes').delete(paperId)
    return tx.complete
  }

  const syncPendingLikes = async () => {
    if (!isOnline) return
    const pending = await getPendingLikes()
    for (const item of pending) {
      try {
        await supabase
          .from('past_papers')
          .update({ likes: item.isLiked ? 1 : 0 })
          .eq('id', item.paperId)
        await clearPendingLike(item.paperId)
      } catch (e) {
        console.warn('sync failed', e)
      }
    }
  }

  useEffect(() => {
    if (isOnline) syncPendingLikes()
  }, [isOnline, syncPendingLikes])

  // Toggle like
  const toggleLike = async (paperId, currentLikes) => {
    const isLikedNow = !likedPapers[paperId]
    const newLikeCount = isLikedNow ? (currentLikes || 0) + 1 : Math.max(0, (currentLikes || 0) - 1)
    setLikedPapers(prev => ({ ...prev, [paperId]: isLikedNow }))
    setAllData(prev =>
      prev.map(p => p.id === paperId ? { ...p, likes: newLikeCount } : p)
    )
    if (isOnline) {
      try {
        await supabase
          .from('past_papers')
          .update({ likes: newLikeCount })
          .eq('id', paperId)
      } catch (err) {
        console.warn('Failed to sync like, storing offline')
        await storePendingLike(paperId, isLikedNow)
      }
    } else {
      await storePendingLike(paperId, isLikedNow)
    }
  }

  // Image processing (memory-safe)
  const processImageSafely = async (file) => {
    let bitmap = null
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: 1200,
        resizeHeight: 1200,
        resizeQuality: 'medium'
      })
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const compressedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
      const thumbCanvas = document.createElement('canvas')
      thumbCanvas.width = 80
      thumbCanvas.height = 80
      const thumbCtx = thumbCanvas.getContext('2d')
      thumbCtx.drawImage(bitmap, 0, 0, 80, 80)
      const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.6)
      bitmap.close()
      const compressedFile = new File([compressedBlob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
        type: 'image/jpeg',
        lastModified: Date.now()
      })
      return { compressedFile, thumbnailDataUrl, size: compressedBlob.size, verified: 'verified' }
    } catch (err) {
      if (bitmap) bitmap.close()
      throw err
    }
  }

  const handleFiles = (files) => {
    const MAX_FILES = 3
    const MAX_RAW_SIZE = 10 * 1024 * 1024
    const newFiles = Array.from(files).filter(f => {
      if (selectedFiles.length >= MAX_FILES) {
        alert(`Max ${MAX_FILES} files allowed`)
        return false
      }
      if (f.size > MAX_RAW_SIZE) {
        alert(`${f.name} is too large (>10MB)`)
        return false
      }
      if (!f.type.startsWith('image/')) {
        alert('Only images allowed')
        return false
      }
      return true
    })
    const toAdd = newFiles.map(file => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      thumbnail: null,
      verified: 'checking',
      id: Date.now() + Math.random()
    }))
    setSelectedFiles(prev => [...prev, ...toAdd])
    setImageQueue(prev => [...prev, ...toAdd])
  }

  useEffect(() => {
    if (imageQueue.length === 0 || isProcessing) return
    const processNext = async () => {
      setIsProcessing(true)
      const next = imageQueue[0]
      try {
        const { compressedFile, thumbnailDataUrl, size } = await processImageSafely(next.file)
        setSelectedFiles(prev =>
          prev.map(f =>
            f.id === next.id
              ? { ...f, file: compressedFile, thumbnail: thumbnailDataUrl, size, verified: 'verified' }
              : f
          )
        )
      } catch (err) {
        console.error('Processing failed', err)
        setSelectedFiles(prev =>
          prev.map(f =>
            f.id === next.id ? { ...f, verified: 'invalid', thumbnail: null } : f
          )
        )
      }
      setImageQueue(prev => prev.slice(1))
      setIsProcessing(false)
    }
    processNext()
  }, [imageQueue, isProcessing])

  const uploadPapers = async () => {
    const { program, course, mid, semester } = uploadForm
    if (!program || !course || !mid || !semester) {
      alert('Please fill all fields')
      return
    }
    const verifiedFiles = selectedFiles.filter(f => f.verified === 'verified')
    if (verifiedFiles.length === 0) {
      alert('No valid files to upload')
      return
    }
    setUploadProgress({ show: true, percent: 0, text: 'Uploading...' })
    let succeeded = 0
    for (let i = 0; i < verifiedFiles.length; i++) {
      const fileData = verifiedFiles[i]
      setUploadProgress(prev => ({ ...prev, percent: (i / verifiedFiles.length) * 100, text: `Uploading ${i+1}/${verifiedFiles.length}: ${fileData.name}` }))
      const safeProgram = sanitizePath(program)
      const safeCourse = sanitizePath(course)
      const safeSemester = sanitizePath(semester)
      const timestamp = Date.now()
      const safeFileName = `${timestamp}_${i}_${sanitizePath(fileData.name)}`
      const filePath = `${safeProgram}/${safeCourse}/${safeSemester}/${safeFileName}`
      try {
        const { error: uploadError } = await supabase.storage
          .from('past-paper')
          .upload(filePath, fileData.file, { cacheControl: '3600', contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
        const { data: publicUrlData } = supabase.storage.from('past-paper').getPublicUrl(filePath)
        const { error: insertError } = await supabase.from('past_papers').insert([{
          program,
          course,
          semester,
          Mid: mid,
          file_name: safeFileName,
          file_url: publicUrlData.publicUrl,
          file_type: 'jpg',
          views: 0,
          likes: 0
        }])
        if (insertError) throw insertError
        succeeded++
      } catch (err) {
        console.error('Upload failed', err)
      }
    }
    setUploadProgress({ show: false, percent: 0, text: '' })
    if (succeeded > 0) {
      alert(`✅ ${succeeded} file(s) uploaded successfully`)
      setUploadModalOpen(false)
      setSelectedFiles([])
      setImageQueue([])
      setUploadForm({ program: '', course: '', mid: '', semester: '' })
      loadPapers()
    } else {
      alert('Upload failed')
    }
  }

  // Render helpers
  const renderPrograms = () => {
    const filtered = searchQuery
      ? allData.filter(d => d.program?.toLowerCase().includes(searchQuery.toLowerCase()))
      : allData
    const programs = [...new Set(filtered.map(d => d.program))]
    if (programs.length === 0) return <div className="text-center py-12 text-muted-foreground">No programs found</div>
    return programs.map(prog => {
      const count = allData.filter(d => d.program === prog).length
      return (
        <div key={prog} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all" onClick={() => { setCurrentProgram(prog); setCurrentView('semesters') }}>
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-2xl">🎓</div>
          <div>
            <h3 className="font-medium">{prog}</h3>
            <p className="text-sm text-muted-foreground">{count} papers</p>
          </div>
        </div>
      )
    })
  }

  const renderSemesters = () => {
    const semesters = [...new Set(allData.filter(d => d.program === currentProgram).map(d => d.semester))]
    if (semesters.length === 0) return <div className="text-center py-12 text-muted-foreground">No semesters found</div>
    return semesters.map(sem => {
      const count = allData.filter(d => d.program === currentProgram && d.semester === sem).length
      return (
        <div key={sem} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all" onClick={() => { setCurrentSemester(sem); setCurrentView('papers') }}>
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-2xl">📅</div>
          <div>
            <h3 className="font-medium">{sem}</h3>
            <p className="text-sm text-muted-foreground">{count} docs</p>
          </div>
        </div>
      )
    })
  }

  const renderPapers = () => {
    let papers = allData.filter(d => d.program === currentProgram && d.semester === currentSemester)
    if (searchQuery) {
      papers = papers.filter(p => p.course?.toLowerCase().includes(searchQuery.toLowerCase()) || p.Mid?.toLowerCase().includes(searchQuery.toLowerCase()))
    }
    const groups = {}
    papers.forEach(p => {
      if (!groups[p.course]) groups[p.course] = []
      groups[p.course].push(p)
    })
    if (Object.keys(groups).length === 0) return <div className="text-center py-12 text-muted-foreground">No papers found</div>

    return Object.entries(groups).map(([course, group]) => {
      const activeIdx = activeThumbs[course] || 0
      const activePaper = group[activeIdx]
      const isLiked = likedPapers[activePaper.id] || false
      return (
        <div key={course} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-all">
          <div className="relative h-48 bg-muted cursor-pointer" onClick={() => window.open(activePaper.file_url, '_blank')}>
            <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-semibold text-blue-600 z-10">{activePaper.Mid || 'Exam'}</span>
            <img
              src={`${activePaper.file_url}?width=400&height=200&quality=60`}
              alt={course}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27200%27%3E%3Crect width=%27400%27 height=%27200%27 fill=%27%23e2e8f0%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27%3E📄%3C/text%3E%3C/svg%3E' }}
            />
          </div>
          {group.length > 1 && (
            <div className="flex gap-2 px-4 pt-3 overflow-x-auto">
              {group.map((p, idx) => (
                <div
                  key={p.id}
                  className={`w-12 h-12 rounded-lg overflow-hidden cursor-pointer border-2 flex-shrink-0 ${idx === activeIdx ? 'border-blue-500' : 'border-transparent'} bg-muted relative`}
                  onClick={() => setActiveThumbs(prev => ({ ...prev, [course]: idx }))}
                >
                  <img src={`${p.file_url}?width=52&height=52`} alt={p.Mid} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] text-center py-0.5">{p.Mid?.slice(0, 6)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="p-4">
            <h3 className="font-bold text-foreground">{course}</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span>{activePaper.file_type?.toUpperCase()}</span>
              <span>•</span>
              <span>{group.length} doc(s)</span>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-4 text-sm">
                <span>👁️ {activePaper.views || 0}</span>
                <button
                  className={`flex items-center gap-1 font-medium ${isLiked ? 'text-red-500' : 'text-muted-foreground'}`}
                  onClick={() => toggleLike(activePaper.id, activePaper.likes)}
                >
                  <span>{isLiked ? '❤️' : '🤍'}</span>
                  <span>{activePaper.likes || 0}</span>
                </button>
              </div>
              <button
                className="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-full text-sm font-semibold hover:bg-blue-100 transition-colors"
                onClick={() => {
                  setBatchPapers(group)
                  setSelectAll(true)
                  setBatchModalOpen(true)
                }}
              >
                📥 Save
              </button>
            </div>
          </div>
        </div>
      )
    })
  }

  const handleBatchDownload = async () => {
    const checkboxes = document.querySelectorAll('.batch-checkbox:checked')
    const selected = Array.from(checkboxes).map(cb => ({
      url: cb.dataset.url,
      name: cb.dataset.name
    }))
    if (selected.length === 0) {
      alert('No files selected')
      return
    }
    for (const item of selected) {
      try {
        const res = await fetch(item.url)
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = item.name
        a.click()
        URL.revokeObjectURL(a.href)
        await new Promise(r => setTimeout(r, 200))
      } catch (e) {
        window.open(item.url, '_blank')
      }
    }
    setBatchModalOpen(false)
  }

  // Determine if we show back button
  const showBack = currentView === 'semesters' || currentView === 'papers'

  return (
    <div className="h-screen overflow-y-auto bg-gradient-to-br from-blue-50 to-purple-50 pb-16 lg:pb-0 w-full">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border px-0 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 px-4">
          {showBack && (
            <button
              className="p-1.5 -ml-2 hover:bg-accent rounded-md transition-colors"
              onClick={() => {
                if (currentView === 'papers') setCurrentView('semesters')
                else setCurrentView('programs')
              }}
            >
              <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="flex items-center gap-2">
            {/* ─── REPLACED EMOJI WITH LOGO ─── */}
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center overflow-hidden">
              <img src="/images/luanar7.png" alt="LUANAR Logo" className="w-full h-full object-cover" />
            </div>
            <h1 className="text-lg font-medium">
              <span className="text-foreground">Past</span>
              <span className="text-blue-600"> Papers</span>
            </h1>
          </div>
          {!isOnline && <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full">Offline</span>}
        </div>

        {/* ─── SEARCH (profile icon removed) ─── */}
        <div className="flex items-center gap-2 px-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search..."
              className="pl-8 pr-3 py-1.5 bg-muted/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 sm:w-48"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT – full width ===== */}
      <div className="px-0 space-y-6 lg:space-y-8 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
          {loading ? (
            // Skeleton
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
                <div className="w-12 h-12 bg-muted rounded-xl mb-3"></div>
                <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </div>
            ))
          ) : (
            <>
              {currentView === 'programs' && renderPrograms()}
              {currentView === 'semesters' && renderSemesters()}
              {currentView === 'papers' && renderPapers()}
            </>
          )}
        </div>
      </div>

      {/* ===== FAB – solid blue ===== */}
      <div className="fixed bottom-20 right-4 z-40">
        <button
          className="w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center text-3xl hover:bg-blue-700 transition-all"
          onClick={() => setUploadModalOpen(true)}
        >
          +
        </button>
      </div>

      {/* ===== UPLOAD MODAL – white background ===== */}
      {uploadModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setUploadModalOpen(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto border border-border shadow-xl">
            <h3 className="text-xl font-bold mb-4">📤 Upload Past Paper</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Program *</label>
                <select className="w-full p-2 border border-border rounded-lg bg-background" value={uploadForm.program} onChange={(e) => setUploadForm({ ...uploadForm, program: e.target.value })}>
                  <option value="">-- Select --</option>
                  {programsList.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Course *</label>
                <input type="text" className="w-full p-2 border border-border rounded-lg bg-background" value={uploadForm.course} onChange={(e) => setUploadForm({ ...uploadForm, course: e.target.value })} placeholder="e.g., Crop Production" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Exam Type *</label>
                <input type="text" className="w-full p-2 border border-border rounded-lg bg-background" value={uploadForm.mid} onChange={(e) => setUploadForm({ ...uploadForm, mid: e.target.value })} placeholder="e.g., Mid Sem, Final" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Semester *</label>
                <select className="w-full p-2 border border-border rounded-lg bg-background" value={uploadForm.semester} onChange={(e) => setUploadForm({ ...uploadForm, semester: e.target.value })}>
                  <option value="">Select</option>
                  {['Semester 1','Semester 2','Semester 3','Semester 4','Semester 5','Semester 6'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Files (Max 3, 10MB each)</label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-accent/50 transition" onClick={() => fileInputRef.current?.click()}>
                  <div className="text-3xl">📁</div>
                  <div className="text-sm text-muted-foreground">Tap or drag files</div>
                  <div className="text-xs text-muted-foreground">JPEG, PNG only</div>
                </div>
                <input type="file" ref={fileInputRef} accept="image/jpeg,image/png" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <button type="button" className="mt-2 w-full py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-100 transition" onClick={() => nativeCameraRef.current?.click()}>📸 Take Photo</button>
                <input type="file" ref={nativeCameraRef} accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {selectedFiles.map((f, idx) => (
                    <div key={f.id} className="border border-border rounded-lg p-2 bg-muted/20 relative">
                      <div className="h-20 flex items-center justify-center bg-muted rounded">
                        {f.verified === 'checking' ? <div className="w-5 h-5 border-2 border-t-blue-500 border-gray-200 rounded-full animate-spin"></div> : f.thumbnail ? <img src={f.thumbnail} alt="" className="h-full object-cover" /> : '📷'}
                      </div>
                      <div className="text-xs truncate mt-1">{f.name.slice(0, 12)}</div>
                      <div className={`text-[10px] ${f.verified === 'verified' ? 'text-green-600' : f.verified === 'invalid' ? 'text-red-500' : 'text-amber-500'}`}>
                        {f.verified === 'verified' ? '✓ Ready' : f.verified === 'invalid' ? 'Error' : 'Processing...'}
                      </div>
                      <button className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center" onClick={() => {
                        setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
                        setImageQueue(prev => prev.filter(q => q.id !== f.id))
                      }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
              {uploadProgress.show && (
                <div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadProgress.percent}%` }}></div></div>
                  <div className="text-xs text-muted-foreground mt-1">{uploadProgress.text}</div>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition" onClick={uploadPapers} disabled={selectedFiles.some(f => f.verified !== 'verified')}>Upload</button>
              <button className="flex-1 py-2.5 border border-border rounded-xl font-medium hover:bg-accent transition" onClick={() => setUploadModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== BATCH DOWNLOAD MODAL ===== */}
      {batchModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setBatchModalOpen(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full max-h-[80vh] border border-border shadow-xl">
            <h3 className="text-xl font-bold mb-4">📥 Select files to save</h3>
            <div className="flex items-center gap-2 mb-3">
              <input type="checkbox" id="selectAll" checked={selectAll} onChange={(e) => setSelectAll(e.target.checked)} className="w-4 h-4 text-blue-600" />
              <label htmlFor="selectAll" className="font-medium">Select All</label>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-2">
              {batchPapers.map(paper => (
                <div key={paper.id} className="flex items-center gap-3 p-2 border-b border-border">
                  <input type="checkbox" className="batch-checkbox w-4 h-4 text-blue-600" data-url={paper.file_url} data-name={paper.file_name || paper.Mid || 'document'} defaultChecked={selectAll} />
                  <img src={`${paper.file_url}?width=48&height=48`} alt="" className="w-12 h-12 object-cover rounded-lg bg-muted" />
                  <div>
                    <div className="font-medium text-sm">{paper.Mid || 'Exam'}</div>
                    <div className="text-xs text-muted-foreground">{paper.file_type?.toUpperCase()}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition" onClick={handleBatchDownload}>Download Selected</button>
              <button className="flex-1 py-2.5 border border-border rounded-xl font-medium hover:bg-accent transition" onClick={() => setBatchModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}