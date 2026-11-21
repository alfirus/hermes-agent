import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import A2uiEmbed from './a2ui-embed'
import { resetA2uiActionStateForTests } from './use-a2ui-action'

const a2uiMocks = vi.hoisted(() => ({
  messageId: 'msg-1',
  running: false,
  scoped: vi.fn(),
  gateway: vi.fn(),
  toast: vi.fn()
}))

let messageSeq = 0

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (snapshot: unknown) => unknown) =>
    select({ message: { id: a2uiMocks.messageId }, thread: { isRunning: a2uiMocks.running } })
}))

vi.mock('@/app/chat/session-view', () => ({
  useSessionView: () => ({ $runtimeId: atom('sess-1') })
}))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway: a2uiMocks.gateway })
}))

vi.mock('@/store/session-states', () => ({
  requestForOwnedSession: (...args: unknown[]) => a2uiMocks.scoped(...args)
}))

vi.mock('@/store/notifications', () => ({
  notifyError: (...args: unknown[]) => a2uiMocks.toast(...args)
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: { assistant: { a2ui: { sendFailed: 'send failed' } } } })
}))

beforeEach(() => {
  a2uiMocks.messageId = `msg-${messageSeq++}`
  a2uiMocks.running = false
  a2uiMocks.scoped.mockReset().mockResolvedValue({ status: 'ok' })
  a2uiMocks.gateway.mockReset()
  a2uiMocks.toast.mockReset()
  resetA2uiActionStateForTests()
})

afterEach(() => {
  cleanup()
})

const V = 'v0.9'

const STREAM = JSON.stringify([
  { version: V, createSurface: { surfaceId: 'plan', catalogId: basicCatalog.id } },
  { version: V, updateDataModel: { surfaceId: 'plan', value: { task: 'Cut release', done: false } } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'plan',
      components: [
        { id: 'root', component: 'Column', children: ['t', 'row'] },
        { id: 't', component: 'Text', text: { path: '/task' } },
        { id: 'row', component: 'Row', children: ['go'] },
        { id: 'go', component: 'Button', child: 'Approve', action: { event: { name: 'approve', context: { choice: 'yes' } } } }
      ]
    }
  }
])

/** The basic catalog renders to light DOM: pierce host elements for their inner content. */
function queryLight<T extends Element = Element>(root: ParentNode, selector: string): T | null {
  return (root as unknown as Element).querySelector?.(selector) as T | null
}

async function catalogButton(container: HTMLElement): Promise<HTMLButtonElement> {
  await waitFor(() => {
    expect(queryLight(container, 'a2ui-basic-button button')).toBeTruthy()
  })

  return queryLight(container, 'a2ui-basic-button button') as HTMLButtonElement
}

describe('A2uiEmbed', () => {
  it('renders bound text and actions from the sealed stream', async () => {
    const { container } = render(<A2uiEmbed code={STREAM} />)

    await waitFor(() => expect(container.textContent).toContain('Cut release'))
    expect(container.querySelector('[data-surface="plan"]')).toBeTruthy()
    await catalogButton(container)
  })

  it('renders past unknown catalog components without crashing scroll', async () => {
    const code = JSON.stringify([
      { version: V, createSurface: { surfaceId: 'w', catalogId: basicCatalog.id } },
      { version: V, updateComponents: { surfaceId: 'w', components: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Hologram' }] } }
    ])

    const { container } = render(<A2uiEmbed code={code} />)

    await waitFor(() => expect(container.querySelector('[data-surface="w"]')).toBeTruthy())
  })
})

describe('A2uiEmbed actions', () => {
  it('submits a button tap as a prompt.submit follow-up on the owning session', async () => {
    const { container } = render(<A2uiEmbed code={STREAM} />)
    fireEvent.click(await catalogButton(container))

    await waitFor(() => expect(a2uiMocks.scoped).toHaveBeenCalledTimes(1))
    const [sessionId, request, method, params] = a2uiMocks.scoped.mock.calls[0] as [string, unknown, string, { text: string }]

    expect(sessionId).toBe('sess-1')
    expect(request).toBe(a2uiMocks.gateway)
    expect(method).toBe('prompt.submit')
    expect(params.text).toContain('[A2UI · plan] approve')
    expect(params.text).toContain('"action":"approve"')
    expect(params.text).toContain('"choice":"yes"')
  })

  it('ignores a double-click while the action is in flight', async () => {
    const { container } = render(<A2uiEmbed code={STREAM} />)
    const button = await catalogButton(container)

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(a2uiMocks.scoped).toHaveBeenCalledTimes(1))
  })

  it('does not submit while a sibling turn is running', async () => {
    a2uiMocks.running = true
    const { container } = render(<A2uiEmbed code={STREAM} />)

    fireEvent.click(await catalogButton(container))
    expect(a2uiMocks.scoped).not.toHaveBeenCalled()
  })

  it('notifies on delivery failure and allows a retry', async () => {
    a2uiMocks.scoped.mockRejectedValueOnce(new Error('gateway down'))
    const { container } = render(<A2uiEmbed code={STREAM} />)
    const button = await catalogButton(container)

    fireEvent.click(button)

    await waitFor(() => expect(a2uiMocks.toast).toHaveBeenCalledTimes(1))

    fireEvent.click(button)

    await waitFor(() => expect(a2uiMocks.scoped).toHaveBeenCalledTimes(2))
  })
})
