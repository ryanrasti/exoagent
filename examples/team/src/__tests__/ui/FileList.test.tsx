/**
 * @vitest-environment jsdom
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'

afterEach(cleanup)
import { FileList } from '../../providers/review/ui/FileList'
import type { ReviewFile } from '../../providers/review/db'

const files: ReviewFile[] = [
	{ id: 'f1', review_id: 'r1', path: 'src/hello.ts', status: 'pending' },
	{ id: 'f2', review_id: 'r1', path: 'src/utils.ts', status: 'reviewing' },
	{ id: 'f3', review_id: 'r1', path: 'src/done.ts', status: 'done' },
]

describe('FileList', () => {
	it('renders file names', () => {
		render(<FileList files={files} selectedFileId={null} onSelect={() => {}} />)
		expect(screen.getByText('src/hello.ts')).toBeDefined()
		expect(screen.getByText('src/utils.ts')).toBeDefined()
		expect(screen.getByText('src/done.ts')).toBeDefined()
	})

	it('shows file count', () => {
		render(<FileList files={files} selectedFileId={null} onSelect={() => {}} />)
		expect(screen.getByText('Files (3)')).toBeDefined()
	})

	it('click file calls onSelect', () => {
		const onSelect = vi.fn()
		render(<FileList files={files} selectedFileId={null} onSelect={onSelect} />)
		fireEvent.click(screen.getByTestId('file-item-src/hello.ts'))
		expect(onSelect).toHaveBeenCalledWith('f1')
	})
})
