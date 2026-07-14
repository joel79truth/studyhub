import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useAuthState } from 'react-firebase-hooks/auth'
import { auth } from '../firebase'
import { BottomNav } from "../components/BottomNav"

// Helper: sanitize for file paths (still kept for potential future use)
const sanitizePath = (str) => str.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)

export default function PastPapers() {
  const [user] = useAuthState(auth)
  const [loading, setLoading] = useState(true)
  const [allData, setAllData] = useState([])
  const [currentView, setCurrentView] = useState('programs')
  const [currentProgram, setCurrentProgram] = useState(null)
  const [currentSemester, setCurrentSemester] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [likedPapers, setLikedPapers] = useState({})
  const [activeThumbs, setActiveThumbs] = useState({})

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxImages, setLightboxImages] = useState([])
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const lightboxImageRef = useRef(null)

  // Batch modal state
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchPapers, setBatchPapers] = useState([])
  const [selectAll, setSelectAll] = useState(true)

  // Offline status
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  // Load liked papers from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('likedPapers')
    if (stored) setLikedPapers(JSON.parse(stored))
  }, [])

  useEffect(() => {
    localStorage.setItem('likedPapers', JSON.stringify(likedPapers))
  }, [likedPapers])

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

  // IndexedDB for offline likes (same as before)
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

  // Open lightbox with group images and index
  const openLightbox = (group, index) => {
    setLightboxImages(group.map(p => p.file_url))
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  // Navigate lightbox
  const lightboxPrev = () => {
    setLightboxIndex(prev => (prev === 0 ? lightboxImages.length - 1 : prev - 1))
  }
  const lightboxNext = () => {
    setLightboxIndex(prev => (prev === lightboxImages.length - 1 ? 0 : prev + 1))
  }

  // Download current lightbox image
  const downloadLightboxImage = async () => {
    const url = lightboxImages[lightboxIndex]
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = url.split('/').pop() || 'paper.jpg'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(url, '_blank')
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
        <div key={course} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-all relative">
          {/* Click opens lightbox */}
          <div className="relative h-48 bg-muted cursor-pointer" onClick={() => openLightbox(group, activeIdx)}>
            <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-semibold text-blue-600 z-10">{activePaper.Mid || 'Exam'}</span>
            <img
              src={activePaper.file_url}
              alt={course}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27200%27%3E%3Crect width=%27400%27 height=%27200%27 fill=%27%23e2e8f0%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27%3E📄%3C/text%3E%3C/svg%3E' }}
            />
          </div>
          {/* Thumbnail slider */}
          {group.length > 1 && (
            <div className="flex gap-2 px-4 pt-3 overflow-x-auto">
              {group.map((p, idx) => (
                <div
                  key={p.id}
                  className={`w-12 h-12 rounded-lg overflow-hidden cursor-pointer border-2 flex-shrink-0 ${idx === activeIdx ? 'border-blue-500' : 'border-transparent'} bg-muted relative`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveThumbs(prev => ({ ...prev, [course]: idx }))
                  }}
                >
                  <img src={p.file_url} alt={p.Mid} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] text-center py-0.5">{p.Mid?.slice(0, 6)}</span>
                </div>
              ))}
            </div>
          )}
          {/* Card footer */}
          <div className="p-4 flex items-end justify-between">
            <div>
              <h3 className="font-bold text-foreground">{course}</h3>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span>{activePaper.file_type?.toUpperCase()}</span>
                <span>•</span>
                <span>{group.length} doc(s)</span>
              </div>
              <div className="flex items-center gap-4 text-sm mt-2">
                <span>👁️ {activePaper.views || 0}</span>
                <button
                  className={`flex items-center gap-1 font-medium ${isLiked ? 'text-red-500' : 'text-muted-foreground'}`}
                  onClick={() => toggleLike(activePaper.id, activePaper.likes)}
                >
                  <span>{isLiked ? '❤️' : '🤍'}</span>
                  <span>{activePaper.likes || 0}</span>
                </button>
              </div>
            </div>
            {/* Small black download circle on bottom left corner */}
            <button
              className="w-9 h-9 bg-black text-white rounded-full flex items-center justify-center shadow-lg hover:bg-gray-800 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                // Download active paper directly
                const a = document.createElement('a')
                a.href = activePaper.file_url
                a.download = activePaper.file_name || 'paper.jpg'
                a.click()
              }}
              title="Download"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          </div>
          {/* Batch save button removed; download circle now provides immediate download */}
        </div>
      )
    })
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

        {/* Search with pure white background */}
        <div className="flex items-center gap-2 px-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search..."
              className="pl-8 pr-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 sm:w-48"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      {/* ===== MAIN CONTENT ===== */}
      <div className="px-0 space-y-6 lg:space-y-8 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
          {loading ? (
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

      {/* ===== LIGHTBOX (WhatsApp‑like image viewer) ===== */}
      {lightboxOpen && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between p-4 text-white">
            <button
              className="p-2 hover:bg-white/10 rounded-full transition"
              onClick={() => setLightboxOpen(false)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <span className="text-sm font-medium">
              {lightboxIndex + 1} / {lightboxImages.length}
            </span>
            <div className="flex gap-2">
              <button
                className="p-2 hover:bg-white/10 rounded-full transition"
                onClick={downloadLightboxImage}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
          </div>
          {/* Image container */}
          <div className="flex-1 flex items-center justify-center relative">
            {lightboxImages.length > 1 && (
              <button
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full z-10 hover:bg-white/30 transition"
                onClick={lightboxPrev}
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <img
              ref={lightboxImageRef}
              src={lightboxImages[lightboxIndex]}
              alt="paper"
              className="max-h-full max-w-full object-contain"
              loading="eager"
            />
            {lightboxImages.length > 1 && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 backdrop-blur-sm rounded-full z-10 hover:bg-white/30 transition"
                onClick={lightboxNext}
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===== BATCH DOWNLOAD MODAL (still present) ===== */}
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
                  <img src={paper.file_url} alt="" className="w-12 h-12 object-cover rounded-lg bg-muted" />
                  <div>
                    <div className="font-medium text-sm">{paper.Mid || 'Exam'}</div>
                    <div className="text-xs text-muted-foreground">{paper.file_type?.toUpperCase()}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition" onClick={async () => {
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
                  } catch {
                    window.open(item.url, '_blank')
                  }
                }
                setBatchModalOpen(false)
              }}>Download Selected</button>
              <button className="flex-1 py-2.5 border border-border rounded-xl font-medium hover:bg-accent transition" onClick={() => setBatchModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}