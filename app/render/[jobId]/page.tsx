'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { RenderJob } from '@/lib/types'

export default function RenderPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = use(params)
  const router = useRouter()
  const [job, setJob] = useState<RenderJob | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false

    async function pollJob() {
      try {
        const res = await fetch(`/api/job/${jobId}`)
        if (!res.ok) throw new Error('Job not found')
        const data: RenderJob = await res.json()
        setJob(data)

        if (data.status === 'complete' || data.status === 'failed') {
          stopped = true
        }
      } catch {
        setError('Failed to fetch job status')
        stopped = true
      }
    }

    const interval = setInterval(() => {
      if (!stopped) pollJob()
    }, 1500)
    pollJob()
    return () => clearInterval(interval)
  }, [jobId])

  const STATUS_MESSAGES: Record<string, string> = {
    pending: 'Waiting in queue...',
    capturing: 'Loading your page...',
    rendering: 'Rendering frames...',
    encoding: 'Encoding video...',
    complete: 'Your video is ready!',
    failed: 'Render failed',
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
      <div className="max-w-xl w-full">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">
          {job ? STATUS_MESSAGES[job.status] : 'Starting render...'}
        </h1>

        {job && (
          <div className="mt-8">
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-indigo-500 transition-all duration-500 rounded-full"
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <p className="text-gray-400 text-sm text-center">
              {job.currentStep}
            </p>

            {job.status === 'complete' && job.downloadUrl && (
              <div className="mt-8 text-center">
                <a
                  href={job.downloadUrl}
                  download
                  className="inline-block px-8 py-4 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl text-lg transition-colors"
                >
                  Download MP4
                </a>
                <button
                  onClick={() => router.push('/')}
                  className="block mx-auto mt-4 text-gray-400 hover:text-white text-sm"
                >
                  Make another
                </button>
              </div>
            )}

            {job.status === 'failed' && (
              <div className="mt-8 text-center">
                <p className="text-red-400 mb-4">
                  {job.error || 'Unknown error occurred'}
                </p>
                <button
                  onClick={() => router.back()}
                  className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl"
                >
                  Try again
                </button>
              </div>
            )}

            <div className="mt-8 grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-gray-900 rounded-xl">
                <p className="text-2xl font-bold text-white">
                  {job.script.steps.length}
                </p>
                <p className="text-gray-500 text-sm">steps</p>
              </div>
              <div className="p-4 bg-gray-900 rounded-xl">
                <p className="text-2xl font-bold text-white">
                  {job.script.steps
                    .reduce((s, st) => s + st.duration, 0)
                    .toFixed(0)}
                  s
                </p>
                <p className="text-gray-500 text-sm">duration</p>
              </div>
              <div className="p-4 bg-gray-900 rounded-xl">
                <p className="text-2xl font-bold text-white">
                  {job.script.fps}
                </p>
                <p className="text-gray-500 text-sm">fps</p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-center mt-4">{error}</p>
        )}
      </div>
    </div>
  )
}
