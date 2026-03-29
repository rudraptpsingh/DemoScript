'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      let normalized = url.trim()
      if (!normalized.startsWith('http')) normalized = 'https://' + normalized

      const scriptId = Date.now().toString()
      sessionStorage.setItem(`script_url_${scriptId}`, normalized)
      router.push(`/editor/${scriptId}?url=${encodeURIComponent(normalized)}`)
    } catch {
      setError('Invalid URL')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <h1 className="text-5xl font-bold text-white mb-4 text-center">
          DemoScript
        </h1>
        <p className="text-gray-400 text-center mb-12 text-lg">
          Paste a URL. Define your story. Get a polished demo video
          automatically.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-product.com"
              className="flex-1 px-5 py-4 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 text-lg focus:outline-none focus:border-indigo-500 transition-colors"
              autoFocus
            />
            <button
              type="submit"
              disabled={!url || loading}
              className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-xl text-lg transition-colors"
            >
              {loading ? 'Loading...' : 'Start'}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </form>

        <div className="mt-16 grid grid-cols-3 gap-6 text-center">
          {[
            {
              title: 'Point at elements',
              desc: 'Click any section of your page to add it to the timeline',
            },
            {
              title: 'Define actions',
              desc: 'Set zoom, scroll, highlight, and duration for each step',
            },
            {
              title: 'Get your MP4',
              desc: 'Download a polished demo video in under 2 minutes',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="p-6 bg-gray-900 rounded-xl border border-gray-800"
            >
              <div className="text-white font-semibold mb-2">{f.title}</div>
              <div className="text-gray-500 text-sm">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
