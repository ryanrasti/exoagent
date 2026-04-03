/**
 * @vitest-environment jsdom
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'

afterEach(cleanup)
import { DiffPane } from '../../providers/review/ui/DiffPane'
import type { DiffHunk } from '../../providers/review/git'

const mockHunks: DiffHunk[] = [
	{
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 2,
		lines: [
			{ type: 'remove', content: 'const x = 1', oldLineNum: 1, newLineNum: null },
			{ type: 'add', content: 'const x = 2', oldLineNum: null, newLineNum: 1 },
			{ type: 'add', content: 'const y = 3', oldLineNum: null, newLineNum: 2 },
		],
	},
]

describe('DiffPane', () => {
	it('renders diff with hunk', () => {
		render(
			<DiffPane
				roundNum={1}
				isMutable={false}
				oldContent="const x = 1\n"
				newContent="const x = 2\nconst y = 3\n"
				hunks={mockHunks}
				threads={[]}
			/>,
		)
		expect(screen.getByTestId('diff-pane-1')).toBeDefined()
		expect(screen.getByTestId('hunk-0')).toBeDefined()
	})

	it('first panel shows plain source (no diff coloring)', () => {
		render(
			<DiffPane
				roundNum={0}
				isMutable={false}
				oldContent="const x = 1\n"
				newContent="const x = 1\n"
				hunks={[]}
				threads={[]}
				isFirst={true}
			/>,
		)
		expect(screen.getByText('Round 0 (base)')).toBeDefined()
	})

	it('click line shows comment input', () => {
		const onCreateThread = vi.fn()
		render(
			<DiffPane
				roundNum={1}
				isMutable={false}
				oldContent="const x = 1\n"
				newContent="const x = 2\nconst y = 3\n"
				hunks={mockHunks}
				threads={[]}
				onCreateThread={onCreateThread}
			/>,
		)
		fireEvent.click(screen.getByTestId('diff-line-add-1'))
		expect(screen.getByTestId('comment-input')).toBeDefined()
		expect(screen.getByTestId('comment-textarea')).toBeDefined()
	})

	it('shows thread markers on commented lines', () => {
		const thread = {
			id: 't1',
			round_id: 'r1',
			original_round_id: 'r1',
			line_start: 1,
			line_end: null,
			snippet: null,
			status: 'open',
			resolved_at: null,
			created_at: Date.now(),
			comments: [{ id: 'c1', thread_id: 't1', body: 'Fix this', author: 'human', created_at: Date.now() }],
		}

		render(
			<DiffPane
				roundNum={1}
				isMutable={false}
				oldContent="const x = 1\n"
				newContent="const x = 2\nconst y = 3\n"
				hunks={mockHunks}
				threads={[thread]}
			/>,
		)
		expect(screen.getByTestId('thread-marker-t1')).toBeDefined()
	})
})
