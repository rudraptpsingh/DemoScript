'use client'
import { useState, useEffect, use } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  PageCapture,
  DemoScript,
  Step,
  CapturedElement,
  ActionType,
} from '@/lib/types'
import { nanoid } from 'nanoid'

export default function EditorPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const { jobId } = use(params)
  const searchParams = useSearchParams()
  const router = useRouter()
  const url = searchParams.get('url') || ''

  const [capture, setCapture] = useState<PageCapture | null>(null)
  const [loading, setLoading] = useState(true)
  const [steps, setSteps] = useState<Step[]>([])
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [hoveredElement, setHoveredElement] = useState<CapturedElement | null>(
    null
  )
  const [isPickingElement, setIsPickingElement] = useState(false)
  const [outputFormat, setOutputFormat] = useState<'mp4' | 'gif'>('mp4')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!url) return
    loadCapture(url)
  }, [url])

  async function loadCapture(targetUrl: string) {
    try {
      setLoading(true)
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      })
      if (!res.ok) throw new Error('Failed to capture page')
      const data: PageCapture = await res.json()
      setCapture(data)

      setSteps([
        {
          id: nanoid(),
          order: 1,
          target: null,
          targetLabel: 'Full page',
          action: 'wait',
          duration: 1.5,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page')
    } finally {
      setLoading(false)
    }
  }

  function addStep(element?: CapturedElement) {
    const newStep: Step = {
      id: nanoid(),
      order: steps.length + 1,
      target: element?.selector || null,
      targetLabel:
        element?.label || element?.innerText?.slice(0, 30) || 'Full page',
      action: 'scroll-to',
      duration: 2.0,
      easing: 'ease-in-out',
    }
    setSteps((prev) => [...prev, newStep])
    setSelectedStep(newStep.id)
    setIsPickingElement(false)
  }

  function updateStep(stepId: string, updates: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...updates } : s))
    )
  }

  function removeStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId))
  }

  function moveStep(stepId: string, direction: 'up' | 'down') {
    const idx = steps.findIndex((s) => s.id === stepId)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === steps.length - 1) return
    const newSteps = [...steps]
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    ;[newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]]
    setSteps(newSteps.map((s, i) => ({ ...s, order: i + 1 })))
  }

  async function startRender() {
    if (steps.length === 0) return

    const script: DemoScript = {
      id: jobId,
      url,
      viewport: { width: 1280, height: 720 },
      fps: 30,
      outputFormat,
      steps,
      createdAt: new Date().toISOString(),
    }

    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    })

    if (!res.ok) {
      alert('Failed to start render')
      return
    }
    const { jobId: renderId } = await res.json()
    router.push(`/render/${renderId}`)
  }

  const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0)

  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading {url}...</p>
        </div>
      </div>
    )

  if (error)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="text-indigo-400 underline"
          >
            Go back
          </button>
        </div>
      </div>
    )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="h-14 border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold">DemoScript</span>
          <span className="text-gray-500 text-sm truncate max-w-xs">
            {url}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">
            {steps.length} steps · {totalDuration.toFixed(1)}s
          </span>
          <select
            value={outputFormat}
            onChange={(e) =>
              setOutputFormat(e.target.value as 'mp4' | 'gif')
            }
            className="bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700"
          >
            <option value="mp4">MP4 (best quality)</option>
            <option value="gif">GIF (for emails/docs)</option>
          </select>
          <button
            onClick={startRender}
            disabled={steps.length === 0}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-lg transition-colors"
          >
            Render {outputFormat.toUpperCase()}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Page Preview + Element Picker */}
        <div className="flex-1 bg-gray-900 relative overflow-hidden">
          {capture && (
            <div
              className="relative"
              style={{
                width: 1280,
                height: 720,
                transform: 'scale(0.6)',
                transformOrigin: 'top left',
              }}
            >
              <img
                src={`data:image/jpeg;base64,${capture.screenshotBase64}`}
                alt="Page preview"
                style={{ width: 1280, height: 720, display: 'block' }}
              />

              {isPickingElement &&
                capture.elements.map((el) => (
                  <div
                    key={el.selector}
                    className="absolute border-2 cursor-pointer transition-all"
                    style={{
                      left: el.boundingBox.x,
                      top: el.boundingBox.y,
                      width: el.boundingBox.width,
                      height: el.boundingBox.height,
                      borderColor:
                        hoveredElement?.selector === el.selector
                          ? '#6366F1'
                          : 'transparent',
                      background:
                        hoveredElement?.selector === el.selector
                          ? '#6366F122'
                          : 'transparent',
                      zIndex: 10,
                    }}
                    onMouseEnter={() => setHoveredElement(el)}
                    onMouseLeave={() => setHoveredElement(null)}
                    onClick={() => addStep(el)}
                  >
                    {hoveredElement?.selector === el.selector && (
                      <div className="absolute -top-8 left-0 bg-indigo-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                        {el.label} · {el.selector}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <button
              onClick={() => setIsPickingElement(!isPickingElement)}
              className={`px-5 py-3 rounded-xl font-semibold transition-all ${
                isPickingElement
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-400'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {isPickingElement
                ? 'Click an element to add step'
                : '+ Add Step'}
            </button>
          </div>
        </div>

        {/* Timeline Sidebar */}
        <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-950">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-white font-semibold">Timeline</h2>
            <p className="text-gray-500 text-xs mt-1">
              {steps.length} steps · {totalDuration.toFixed(1)}s total
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {steps.map((step, idx) => (
              <StepCard
                key={step.id}
                step={step}
                index={idx}
                isSelected={selectedStep === step.id}
                onSelect={() => setSelectedStep(step.id)}
                onUpdate={(updates) => updateStep(step.id, updates)}
                onRemove={() => removeStep(step.id)}
                onMoveUp={() => moveStep(step.id, 'up')}
                onMoveDown={() => moveStep(step.id, 'down')}
                isFirst={idx === 0}
                isLast={idx === steps.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepCard({
  step,
  index,
  isSelected,
  onSelect,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  step: Step
  index: number
  isSelected: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<Step>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const ACTION_LABELS: Record<ActionType, string> = {
    'scroll-to': 'Scroll',
    'zoom-in': 'Zoom In',
    'zoom-out': 'Zoom Out',
    highlight: 'Highlight',
    pan: 'Pan',
    'cursor-move': 'Cursor',
    wait: 'Wait',
    click: 'Click',
  }

  return (
    <div
      className={`rounded-xl border p-4 cursor-pointer transition-all ${
        isSelected
          ? 'border-indigo-500 bg-gray-800'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs w-5 text-center">
            {index + 1}
          </span>
          <div>
            <p className="text-white text-sm font-medium">
              {step.targetLabel || 'Full page'}
            </p>
            <p className="text-gray-500 text-xs">
              {ACTION_LABELS[step.action]} · {step.duration}s
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMoveUp()
            }}
            disabled={isFirst}
            className="p-1 text-gray-500 hover:text-white disabled:opacity-30"
          >
            ↑
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMoveDown()
            }}
            disabled={isLast}
            className="p-1 text-gray-500 hover:text-white disabled:opacity-30"
          >
            ↓
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="p-1 text-gray-500 hover:text-red-400"
          >
            x
          </button>
        </div>
      </div>

      {isSelected && (
        <div className="mt-4 space-y-3 pt-3 border-t border-gray-700">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Action
              </label>
              <select
                value={step.action}
                onChange={(e) =>
                  onUpdate({ action: e.target.value as ActionType })
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-gray-800 text-white text-sm px-2 py-1.5 rounded border border-gray-700"
              >
                <option value="wait">Wait</option>
                <option value="scroll-to">Scroll to</option>
                <option value="zoom-in">Zoom in</option>
                <option value="zoom-out">Zoom out</option>
                <option value="highlight">Highlight</option>
                <option value="pan">Pan</option>
                <option value="cursor-move">Move cursor</option>
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Duration (s)
              </label>
              <input
                type="number"
                value={step.duration}
                min={0.5}
                max={10}
                step={0.5}
                onChange={(e) =>
                  onUpdate({ duration: parseFloat(e.target.value) })
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-gray-800 text-white text-sm px-2 py-1.5 rounded border border-gray-700"
              />
            </div>
          </div>

          {(step.action === 'zoom-in' || step.action === 'zoom-out') && (
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Zoom level ({step.zoom || 2.0}x)
              </label>
              <input
                type="range"
                min={1.5}
                max={4}
                step={0.5}
                value={step.zoom || 2.0}
                onChange={(e) =>
                  onUpdate({ zoom: parseFloat(e.target.value) })
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full"
              />
            </div>
          )}

          {step.action === 'highlight' && (
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Highlight color
              </label>
              <input
                type="color"
                value={step.highlightColor || '#3B82F6'}
                onChange={(e) =>
                  onUpdate({ highlightColor: e.target.value })
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full h-8 bg-gray-800 rounded border border-gray-700 cursor-pointer"
              />
            </div>
          )}

          <div>
            <label className="text-gray-400 text-xs block mb-1">
              Easing
            </label>
            <select
              value={step.easing || 'ease-in-out'}
              onChange={(e) =>
                onUpdate({ easing: e.target.value as Step['easing'] })
              }
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-gray-800 text-white text-sm px-2 py-1.5 rounded border border-gray-700"
            >
              <option value="ease-in-out">Ease in/out (smooth)</option>
              <option value="ease-in">Ease in (slow start)</option>
              <option value="ease-out">Ease out (slow end)</option>
              <option value="linear">Linear</option>
            </select>
          </div>

          <div>
            <label className="text-gray-400 text-xs block mb-1">
              Annotation (optional)
            </label>
            <input
              type="text"
              value={step.annotation || ''}
              onChange={(e) => onUpdate({ annotation: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder="Text overlay for this step"
              className="w-full bg-gray-800 text-white text-sm px-2 py-1.5 rounded border border-gray-700 placeholder-gray-600"
            />
          </div>
        </div>
      )}
    </div>
  )
}
