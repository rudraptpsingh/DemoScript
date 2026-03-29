'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { RenderJob } from '@/lib/types'

interface MultiFormatOutput {
  formatId: string
  label: string
  icon: string
  downloadUrl?: string
  fileSizeBytes?: number
  error?: string
  loading: boolean
}

const FORMAT_META: Record<string, { label: string; icon: string }> = {
  'mp4-standard': { label: 'Standard MP4', icon: '\uD83C\uDFAC' },
  'mp4-twitter': { label: 'Twitter/X MP4', icon: '\uD835\uDD4F' },
  'mp4-linkedin': { label: 'LinkedIn MP4', icon: 'in' },
  'gif': { label: 'GIF', icon: '\uD83D\uDD01' },
  'thumbnail': { label: 'Thumbnail PNG', icon: '\uD83D\uDDBC' },
}

function formatFileSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export default function RenderPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = use(params)
  const router = useRouter()
  const [job, setJob] = useState<RenderJob | null>(null)
  const [error, setError] = useState('')
  const [multiFormats, setMultiFormats] = useState<MultiFormatOutput[]>([])

  useEffect(() => {
    let stopped = false

    async function pollJob() {
      try {
        const res = await fetch(`/api/job/${jobId}`)
        if (!res.ok) throw new Error('Job not found')
        const data: RenderJob = await res.json()
        setJob(data)

        // Update multi-format outputs if available
        if (data.status === 'complete') {
          buildMultiFormatOutputs(data)
        }

        if (data.status === 'complete' || data.status === 'failed') {
          stopped = true
        }
      } catch {
        setError('Failed to fetch job status')
        stopped = true
      }
    }

    function buildMultiFormatOutputs(job: RenderJob) {
      // Check if this was a multi-format render by looking at the script outputFormat
      // or by checking if the job has multiple download URLs (future API support)
      if (!job.downloadUrl) return

      // Single format: show one download button
      setMultiFormats([])
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
              <div className="mt-8">
                {/* Primary download button */}
                <div className="text-center mb-6">
                  <a
                    href={job.downloadUrl}
                    download
                    className="inline-block px-8 py-4 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl text-lg transition-colors"
                  >
                    Download {job.script.outputFormat?.toUpperCase() || 'Video'}
                  </a>
                </div>

                {/* Multi-format download buttons */}
                {multiFormats.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-gray-400 text-sm font-medium mb-3 text-center">
                      Additional formats
                    </h3>
                    <div className="grid grid-cols-1 gap-2">
                      {multiFormats.map((fmt) => (
                        <div
                          key={fmt.formatId}
                          className={`flex items-center justify-between p-3 rounded-xl border ${
                            fmt.error
                              ? 'border-red-900 bg-red-950'
                              : 'border-gray-800 bg-gray-900'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{fmt.icon}</span>
                            <div>
                              <p className="text-white text-sm font-medium">{fmt.label}</p>
                              {fmt.fileSizeBytes && (
                                <p className="text-gray-500 text-xs">
                                  {formatFileSize(fmt.fileSizeBytes)}
                                </p>
                              )}
                              {fmt.error && (
                                <p className="text-red-400 text-xs" title={fmt.error}>
                                  Failed
                                </p>
                              )}
                            </div>
                          </div>
                          {fmt.loading ? (
                            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                          ) : fmt.downloadUrl ? (
                            <a
                              href={fmt.downloadUrl}
                              download
                              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                            >
                              Download
                            </a>
                          ) : fmt.error ? (
                            <span className="text-red-400 text-xs">Error</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => router.push('/')}
                  className="block mx-auto mt-6 text-gray-400 hover:text-white text-sm"
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
