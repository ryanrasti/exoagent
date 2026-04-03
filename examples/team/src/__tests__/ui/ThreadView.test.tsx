/**
 * @vitest-environment jsdom
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { ThreadView } from '../../providers/review/ui/ThreadView'

afterEach(cleanup)

const baseThread = {
	id: 't1',
	round_id: 'r1',
	original_round_id: 'r1',
	line_start: 42,
	line_end: null,
	snippet: 'const x = 1',
	status: 'open' as const,
	resolved_at: null,
	created_at: Date.now(),
	file_path: 'src/hello.ts',
	comments: [
		{ id: 'c1', thread_id: 't1', body: 'This should use for...of', author: 'human', created_at: Date.now() },
		{ id: 'c2', thread_id: 't1', body: 'Fixed, switched from forEach', author: 'agent', created_at: Date.now() + 1 },
	],
}

const noop = () => {}

describe('ThreadView', () => {
	it('renders thread with all comments', () => {
		render(
			<ThreadView
				thread={baseThread}
				onReply={noop} onResolve={noop} onDefer={noop}
				onReopen={noop} onWontfix={noop} onAddress={noop}
			/>,
		)
		expect(screen.getByText('This should use for...of')).toBeDefined()
		expect(screen.getByText('Fixed, switched from forEach')).toBeDefined()
	})

	it('shows status badge', () => {
		render(
			<ThreadView
				thread={baseThread}
				onReply={noop} onResolve={noop} onDefer={noop}
				onReopen={noop} onWontfix={noop} onAddress={noop}
			/>,
		)
		expect(screen.getByTestId('thread-status-open')).toBeDefined()
	})

	it('shows file location', () => {
		render(
			<ThreadView
				thread={baseThread}
				onReply={noop} onResolve={noop} onDefer={noop}
				onReopen={noop} onWontfix={noop} onAddress={noop}
			/>,
		)
		expect(screen.getByText('src/hello.ts:42')).toBeDefined()
	})

	it('resolve button calls onResolve', () => {
		const onResolve = vi.fn()
		render(
			<ThreadView
				thread={baseThread}
				onReply={noop} onResolve={onResolve} onDefer={noop}
				onReopen={noop} onWontfix={noop} onAddress={noop}
			/>,
		)
		fireEvent.click(screen.getByTestId('resolve-button'))
		expect(onResolve).toHaveBeenCalledWith('t1')
	})

	it('defer button calls onDefer', () => {
		const onDefer = vi.fn()
		render(
			<ThreadView
				thread={baseThread}
				onReply={noop} onResolve={noop} onDefer={onDefer}
				onReopen={noop} onWontfix={noop} onAddress={noop}
			/>,
		)
		fireEvent.click(screen.getByTestId('defer-button'))
		expect(onDefer).toHaveBeenCalledWith('t1')
	})

	it('addressed thread shows reopen button', () => {
		const addressed = { ...baseThread, status: 'addressed' as const }
		const onReopen = vi.fn()
		render(
			<ThreadView
				thread={addressed}
				onReply={noop} onResolve={noop} onDefer={noop}
				onReopen={onReopen} onWontfix={noop} onAddress={noop}
			/>,
		)
		fireEvent.click(screen.getByTestId('reopen-button'))
		expect(onReopen).toHaveBeenCalledWith('t1')
	})

	it('resolved thread has no action buttons except reply', () => {
		const resolved = { ...baseThread, status: 'resolved' as const, resolved_at: Date.now() }
		render(
			<ThreadView
				thread={resolved}
				onReply={noop} onResolve={noop} onDefer={noop}
				onReopen={noop} onWontfix={noop} onAddress={noop}
			/>,
		)
		expect(screen.getByTestId('reply-button')).toBeDefined()
		expect(screen.queryByTestId('resolve-button')).toBeNull()
		expect(screen.queryByTestId('defer-button')).toBeNull()
	})
})
